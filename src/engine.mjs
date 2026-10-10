#!/usr/bin/env node
import { createInterface } from 'node:readline';
import path from 'node:path';
import { appendFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Domain packs
import { inspect } from './lib/inspect.mjs';
import { verify } from './lib/verify.mjs';
import { inspectFilmProject, verifyMediaLinks, applyFilmPatch } from '../packs/film/dist/index.js';

// Protocol & Contracts
import {
  serializeProtocolMessage,
  parseProtocolMessage,
} from '../packages/contracts/dist/index.js';

// Kernel Execution
import {
  runTask,
  InMemoryActionGuard,
  FileEventStore,
} from '../packages/kernel/dist/index.js';
import { makeStepAction } from './lib/actions.mjs';

// Models (Planning & Routing)
import {
  CapabilityRouter,
  generateReadOnlyPlan,
  compilePlan,
} from '../packages/models/dist/index.js';
import { selectModelProvider } from './lib/providers.mjs';

const rl = createInterface({ input: process.stdin, terminal: false });
const TASK_LOG_DIR = process.env.JUNUB_TASK_LOG_DIR || path.join('.junub', 'tasks');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const HISTORY_FILE = path.join(ROOT_DIR, '.junub', 'history.jsonl');

process.stderr.write('[engine] History file target: ' + HISTORY_FILE + '\n');

async function logHistory(record) {
  try {
    await mkdir(path.dirname(HISTORY_FILE), { recursive: true });
    await appendFile(HISTORY_FILE, JSON.stringify(record) + '\n');
    process.stderr.write('[engine] History logged successfully.\n');
  } catch (err) {
    process.stderr.write('[engine] Failed to write history: ' + err.message + '\n');
  }
}

class StreamingEventStore extends FileEventStore {
  constructor(filePath, emit) {
    super(filePath);
    this.emit = emit;
  }

  async appendTaskEvent(request) {
    const stored = await super.appendTaskEvent(request);
    this.emit({
      protocolVersion: 1,
      taskId: stored.taskId,
      sequence: stored.sequence,
      eventId: stored.eventId,
      type: stored.type,
      payload: stored.payload,
      timestamp: stored.occurredAt,
    });
    return stored;
  }
}

async function executeRealTask(taskId, contract, plan) {
  const emit = (evt) => {
    try {
      process.stdout.write(serializeProtocolMessage(evt) + '\n');
    } catch (e) {
      process.stderr.write('[engine] emit failed: ' + e.message + '\n');
    }
  };

  const filePath = path.join(TASK_LOG_DIR, taskId + '.jsonl');
  const eventStore = new StreamingEventStore(filePath, emit);
  const actionGuard = new InMemoryActionGuard();

  const plannedSteps = Array.isArray(plan)
    ? plan
    : contract.acceptance.map((c) => ({
      stepId: c.id,
      statement: c.statement,
      action: { kind: 'noop', params: { statement: c.statement } },
    }));

  const steps = plannedSteps.map((s) => ({
    stepId: s.stepId || s.id || 'step-' + Math.random().toString(36).slice(2),
    statement: s.statement || s.stepId || s.id,
    action: makeStepAction(s.action),
  }));

  try {
    await runTask({ taskId, steps, eventStore, actionGuard });
    await logHistory({
      timestamp: new Date().toISOString(),
      taskId,
      event: 'task_completed',
      contract: { title: contract.title, intent: contract.intent, domain: contract.domain },
      status: 'succeeded',
      executedSteps: steps.map((s) => ({ stepId: s.stepId, statement: s.statement, kind: s.action.kind })),
    });
  } catch (err) {
    process.stderr.write('[engine] task execution error: ' + err.message + '\n');
    await logHistory({
      timestamp: new Date().toISOString(),
      taskId,
      event: 'task_failed',
      contract: { title: contract.title, intent: contract.intent, domain: contract.domain },
      status: 'failed',
      error: err.message,
    });
  }
}

rl.on('line', async (line) => {
  let request;

  try {
    request = parseProtocolMessage(line);
    if (!request.requestId || !request.method) {
      throw new Error('Missing requestId or method');
    }
  } catch (err) {
    process.stdout.write(
      serializeProtocolMessage({
        protocolVersion: 1,
        requestId: 'unknown',
        success: false,
        error: { code: 'PROTOCOL_MALFORMED', message: err.message },
        timestamp: new Date().toISOString(),
      }) + '\n'
    );
    return;
  }

  let result;
  let success = true;
  let errorPayload;

  try {
    if (request.method === 'pack.software.inspect') {
      result = await inspect(request.params?.path || '.');
    } else if (request.method === 'pack.software.verify') {
      result = await verify(request.params?.path || '.', request.params?.scripts || []);
    } else if (request.method === 'pack.film.inspect') {
      result = await inspectFilmProject(request.params?.path || '.');
    } else if (request.method === 'pack.film.verify') {
      result = await verifyMediaLinks(request.params?.path || '.');
    } else if (request.method === 'pack.film.applyPatch') {
      result = await applyFilmPatch(
        request.params?.path || '.',
        request.params?.patch,
        { allowDirty: request.params?.allowDirty === true },
      );
    } else if (request.method === 'pack.film.fix') {
      const { path: projectPath } = request.params || {};
      const { inspectFilmProject } = await import('../packs/film/dist/index.js');
      const { readFile, readdir } = await import('node:fs/promises');
      const pathModule = await import('node:path');

      // 1. Inspect the project to find missing and available media
      const report = await inspectFilmProject(projectPath || '.');
      const allClips = report.clips || [];
      const missingClips = allClips.filter(c => !c.mediaExists && c.source === 'timeline');
      const availableClips = allClips.filter(c => c.mediaExists && c.source === 'raw_media');

      if (missingClips.length === 0) {
        result = { missingClips: [], proposedRelsinks: [], timelinePath: null };
      } else {
        // 2. Find the EDL timeline path
        const edlTimeline = report.timelines.find(t => t.format === 'edl');
        const timelinePath = edlTimeline ? pathModule.join(projectPath || '.', edlTimeline.path) : null;

        // 3. Use LLM to propose relinks
        const { provider, model } = selectModelProvider();
        const router = new CapabilityRouter([provider]);
        await router.refreshModels();

        const missingList = missingClips.map(c => c.clipName).join('\n');
        const availableList = availableClips.map(c => c.clipName).join('\n');

        const system = 'You are a film editor assistant. You are given a list of missing media files referenced in an EDL timeline, and a list of available media files on disk. ' +
          'Match each missing file to the most appropriate available file. ' +
          'Output ONLY a valid JSON array of objects like: [{"missingFile": "missing.mp4", "availableFile": "existing.mp4"}]. ' +
          'If there are more missing files than available files, reuse available files as needed. ' +
          'If there are no available files, return an empty array.';

        const user = 'MISSING MEDIA FILES:\n' + missingList + '\n\nAVAILABLE MEDIA FILES:\n' + availableList;

        const response = await provider.complete({
          modelId: model || 'qwen/qwen-2.5-72b-instruct',
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          temperature: 0.1,
          maxOutputTokens: 512,
        });

        let cleaned = response.content.trim();
        if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');

        // Extract JSON array
        const firstBracket = cleaned.indexOf('[');
        const lastBracket = cleaned.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket > firstBracket) {
          cleaned = cleaned.substring(firstBracket, lastBracket + 1);
        }

        let proposedRelsinks = [];
        try {
          proposedRelsinks = JSON.parse(cleaned);
        } catch (e) {
          proposedRelsinks = [];
        }

        result = {
          missingClips: missingClips.map(c => ({ clipName: c.clipName, mediaPath: c.mediaPath })),
          proposedRelsinks,
          timelinePath,
        };
      }

    } else if (request.method === 'pack.film.applyFix') {
      const { path: projectPath, timelinePath, relinks } = request.params || {};
      const { readFile, writeFile } = await import('node:fs/promises');
      const { inspectFilmProject } = await import('../packs/film/dist/index.js');

      if (!timelinePath || !relinks || relinks.length === 0) {
        throw new Error('Missing timelinePath or relinks');
      }

      // 1. Read the EDL file
      let edlContent = await readFile(timelinePath, 'utf8');

      // 2. Create backup
      const backupPath = timelinePath + '.bak';
      await writeFile(backupPath, edlContent, 'utf8');

      // 3. Apply relinks
      let fixedCount = 0;
      for (const relink of relinks) {
        if (edlContent.includes(relink.missingFile)) {
          edlContent = edlContent.replace(relink.missingFile, relink.availableFile);
          fixedCount++;
        }
      }

      // 4. Write the fixed EDL
      await writeFile(timelinePath, edlContent, 'utf8');

      // 5. Verify by re-inspecting
      const verifyReport = await inspectFilmProject(projectPath || '.');
      const stillMissing = (verifyReport.clips || []).filter(c => !c.mediaExists && c.source === 'timeline');

      if (stillMissing.length > 0) {
        // Verification failed - revert
        await writeFile(timelinePath, edlContent, 'utf8');
        result = {
          success: false,
          fixedCount,
          error: 'Verification failed. ' + stillMissing.length + ' media files still missing after patch.',
          reverted: true,
        };
      } else {
        result = {
          success: true,
          fixedCount,
          error: null,
          reverted: false,
        };
      }
    }
    else if (request.method === 'chat.run') {
      const { command, args, cwd } = request.params || {};
      if (!command) throw new Error('Missing command');

      const { run } = await import('./lib/process.mjs');
      const workDir = cwd || process.cwd();
      process.stderr.write('[engine] Running command: ' + command + ' ' + (args || []).join(' ') + ' in ' + workDir + '\n');

      result = await run(command, args || [], workDir, {
        timeoutMs: 120000,
        maxOutputBytes: 131072,
        shell: true,
      });

      process.stderr.write('[engine] Command exited with code: ' + result.exitCode + '\n');
      result.success = result.exitCode === 0 && !result.error && !result.timedOut;

    } else if (request.method === 'chat.diagnose') {
      const { command, stdout, stderr } = request.params || {};
      const { provider, model } = selectModelProvider();
      const router = new CapabilityRouter([provider]);
      await router.refreshModels();

      // Strip ANSI color codes for better LLM comprehension
      const rawOutput = ((stderr || '') + '\n' + (stdout || '')).replace(/\x1b\[[0-9;]*m/g, '');
      const errorText = rawOutput.slice(-4000);

      const system = 'You are an expert debugger. A terminal command failed. Look at the error message and the code snippet provided. ' +
        'Identify the EXACT syntax error (like a missing bracket, typo, or wrong import). ' +
        'Output ONLY a valid JSON object like: {"filePath": "src/foo.js", "instruction": "Add the missing opening curly brace { on line 7 after the function declaration"}. ' +
        'Do NOT suggest deleting the code. Fix the root cause. ' +
        'If you cannot identify a specific file to fix, return {"filePath": null, "instruction": "Reason why you cannot fix it"}.';

      const user = 'Command: ' + command + '\n\nError Output:\n' + errorText;

      const response = await provider.complete({
        modelId: model || 'qwen2.5:3b',
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.1,
        maxOutputTokens: 256,
      });

      let cleaned = response.content.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');

      // RESILIENT JSON PARSING: Extract just the {...} object, ignoring trailing garbage like ";}"
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      }

      try {
        result = JSON.parse(cleaned);
      } catch (e) {
        result = { filePath: null, instruction: 'Failed to parse diagnosis: ' + cleaned };
      }

    } else if (request.method === 'chat.edit') {
      const { filePath, instruction, fileContent } = request.params || {};
      if (!filePath || !instruction) throw new Error('Missing filePath or instruction');

      const { provider, model } = selectModelProvider();
      const router = new CapabilityRouter([provider]);
      await router.refreshModels();

      const systemContent = `You are an expert code editor. Your job is to fix errors in code.
You MUST output the changes using the SEARCH/REPLACE block format.
Do NOT output the entire file. Only output the exact lines that need to change.

Format:
<<<<<<< SEARCH
[exact original code to find, character-for-character]
=======
[new code to replace it with]
>>>>>>> REPLACE

Rules:
1. The SEARCH block must EXACTLY match a contiguous block of code in the original file. Include enough context (surrounding lines) to make it unique.
2. Output ONLY the SEARCH/REPLACE block(s). No explanations, no markdown code fences.
3. If you need to add a missing bracket, include the line above it in the SEARCH block.`;

      const userContent = 'FILE PATH: ' + filePath +
        '\n\nINSTRUCTION: ' + instruction +
        '\n\nCURRENT FILE CONTENT:\n' + (fileContent || '(empty file)') +
        '\n\nOUTPUT THE SEARCH/REPLACE BLOCK NOW:';

      const response = await provider.complete({
        modelId: model || 'qwen2.5:3b',
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        maxOutputTokens: 2048,
      });

      let rawOutput = response.content.trim();
      if (rawOutput.startsWith('```')) {
        rawOutput = rawOutput.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
      }

      let editedContent = fileContent || '';
      let appliedCount = 0;

      // Helper function to apply a search/replace pair with fuzzy matching
      const applyPatch = (searchBlock, replaceBlock) => {
        // 1. Try exact match first
        if (editedContent.includes(searchBlock)) {
          editedContent = editedContent.replace(searchBlock, replaceBlock);
          appliedCount++;
          return true;
        }
        // 2. Fuzzy match fallback (crucial for 3B models that mess up indentation)
        const searchLines = searchBlock.split('\n').map((l) => l.trim()).filter((l) => l);
        if (searchLines.length === 0) return false;

        const fileLines = editedContent.split('\n');
        for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
          let matchAll = true;
          for (let j = 0; j < searchLines.length; j++) {
            if (fileLines[i + j].trim() !== searchLines[j]) {
              matchAll = false;
              break;
            }
          }
          if (matchAll) {
            const replaceLines = replaceBlock.split('\n');
            fileLines.splice(i, searchLines.length, ...replaceLines);
            editedContent = fileLines.join('\n');
            appliedCount++;
            return true;
          }
        }
        return false;
      };

      // FORMAT 1: Strict Aider/Cursor format
      const strictRegex = /<<<<<<< SEARCH\n([\s\S]*?)\n?=======\n([\s\S]*?)\n?>>>>>>> REPLACE/g;
      let match;
      while ((match = strictRegex.exec(rawOutput)) !== null) {
        applyPatch(match[1], match[2]);
      }

      // FORMAT 2: Simple SEARCH/REPLACE (common for small 3B models)
      if (appliedCount === 0) {
        process.stderr.write('[engine] Strict format not found. Trying simple SEARCH/REPLACE format...\n');
        const simpleRegex = /SEARCH:\s*\n([\s\S]*?)\nREPLACE:\s*\n([\s\S]*?)(?=\nSEARCH:|$)/gi;
        while ((match = simpleRegex.exec(rawOutput)) !== null) {
          applyPatch(match[1], match[2]);
        }
      }

      if (appliedCount === 0) {
        throw new Error('Failed to apply changes. The model did not output a recognizable SEARCH/REPLACE block. Raw output:\n' + rawOutput.slice(0, 500));
      }

      result = {
        filePath: filePath,
        originalContent: fileContent || '',
        editedContent: editedContent,
        instruction: instruction,
        modelUsed: model || 'unknown',
      };
    } else if (request.method === 'chat.query') {
      const { message, history, workspaceContext } = request.params || {};
      if (!message) throw new Error('Missing message');

      const { provider, source, model } = selectModelProvider();
      const router = new CapabilityRouter([provider]);
      await router.refreshModels();

      const historyText =
        history && history.length > 0
          ? history.map((h) => h.role + ': ' + h.content).join('\n')
          : '';

      const systemContent =
        'You are Junub Agent, an expert software engineer working inside a VS Code workspace. ' +
        'You have access to the workspace structure and files provided below. ' +
        'Answer the user question accurately using ONLY the real files and context provided. ' +
        'Never hallucinate file paths or invent files that do not exist. ' +
        'If you reference a file, use its exact path from the workspace context. ' +
        'Be specific, technical, and concise. Use markdown formatting for readability.';

      const userContent =
        'WORKSPACE CONTEXT:\n' +
        (workspaceContext || 'No workspace open.') +
        '\n\nCONVERSATION HISTORY:\n' +
        (historyText || 'No previous messages.') +
        '\n\nUSER QUESTION:\n' +
        message;

      const response = await provider.complete({
        modelId: model || 'qwen2.5:3b',
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
        maxOutputTokens: 2048,
      });

      result = { response: response.content, modelUsed: model || 'unknown' };
    } else if (request.method === 'task.refine') {
      const { message, history, workspaceContext } = request.params || {};
      if (!message) throw new Error('Missing message for refinement');

      const { provider, source, model } = selectModelProvider();
      const router = new CapabilityRouter([provider]);
      await router.refreshModels();

      const historyText =
        history && history.length > 0
          ? `Previous context:\n${history.map((h) => `${h.role}: ${h.content}`).join('\n')}`
          : 'No previous context.';

      const contextBlock = workspaceContext
        ? `\n\nCURRENT WORKSPACE CONTEXT (Use these exact paths, folders, and technologies. DO NOT hallucinate fake files):\n${workspaceContext}`
        : '';

      const refinePrompt = [
        {
          role: 'system',
          content: `You are an AI agent coordinator. Convert the user's request into a JSON object.
You MUST output ONLY valid JSON. No markdown, no explanations.
${contextBlock}

If the request is clear and actionable, output this EXACT structure:
{
  "contract": {
    "taskId": "chat-1",
    "title": "Short Title",
    "intent": "Clear intent based on context",
    "domain": "software",
    "impact": "low",
    "outputs": [],
    "acceptance": [
      { "id": "a1", "statement": "First measurable criterion using real file names from context" }
    ]
  }
}

If the request is too vague even with context, output this EXACT structure:
{
  "question": "What specific part should I focus on?"
}`,
        },
        { role: 'user', content: `${historyText}\n\nUser request: ${message}` },
      ];

      const response = await provider.complete({
        modelId: model || 'qwen2.5:3b',
        messages: refinePrompt,
        temperature: 0.1,
        maxOutputTokens: 512,
      });

      let cleaned = response.content.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      try {
        result = JSON.parse(cleaned);
        process.stderr.write('[engine] task.refine RAW OUTPUT: ' + cleaned + '\n');
      } catch (err) {
        throw new Error(`Failed to parse refinement JSON: ${err.message}. Raw: ${cleaned.slice(0, 200)}`);
      }
    } else if (request.method === 'task.plan') {
      const contract = request.params?.contract;
      if (!contract || !Array.isArray(contract.acceptance)) {
        throw new Error('Invalid task contract: missing acceptance criteria');
      }
      const { provider, source } = selectModelProvider();
      process.stderr.write('[engine] task.plan using provider: ' + source + '\n');
      const router = new CapabilityRouter([provider]);
      await router.refreshModels();
      result = await generateReadOnlyPlan(contract, { router });

      await logHistory({
        timestamp: new Date().toISOString(),
        taskId: contract.taskId || 'unknown',
        event: 'plan_generated',
        contract: { title: contract.title, intent: contract.intent, domain: contract.domain },
        planStepsCount: result.steps ? result.steps.length : 0,
        modelUsed: result.modelUsed || source,
        plan: result.steps || null,
        refusal: result.reason
          ? { reason: result.reason, message: result.message, suggestedNextAction: result.suggestedNextAction }
          : null,
      });
    } else if (request.method === 'task.compile') {
      const plan = request.params?.plan;
      const context = request.params?.context;
      if (!plan || !context) {
        throw new Error('Missing plan or context for compilation');
      }
      result = compilePlan(plan, context);
    } else if (request.method === 'task.run') {
      const contract = request.params?.contract;
      if (!contract || !Array.isArray(contract.acceptance)) {
        throw new Error('Invalid task contract: missing acceptance criteria');
      }
      const taskId = contract.taskId || 'task-' + Date.now();

      process.stdout.write(
        serializeProtocolMessage({
          protocolVersion: 1,
          requestId: request.requestId,
          success: true,
          result: { taskId, status: 'accepted' },
          timestamp: new Date().toISOString(),
        }) + '\n'
      );

      executeRealTask(taskId, contract, request.params?.plan);
      return;
    } else {
      throw new Error('Unknown method: ' + request.method);
    }
  } catch (err) {
    success = false;
    errorPayload = { code: err.code || 'UNKNOWN_ERROR', message: err.message };
  }

  process.stdout.write(
    serializeProtocolMessage({
      protocolVersion: 1,
      requestId: request.requestId,
      success,
      ...(success ? { result } : { error: errorPayload }),
      timestamp: new Date().toISOString(),
    }) + '\n'
  );
});

process.stderr.write('[engine] Junub Agent headless engine started.\n');

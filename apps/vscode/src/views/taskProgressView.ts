import * as vscode from 'vscode';

interface StepNode {
  stepId: string;
  statement: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
}

export class TaskProgressProvider implements vscode.TreeDataProvider<StepNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<StepNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private steps: Map<string, StepNode> = new Map();

  reset() {
    this.steps.clear();
    this._onDidChangeTreeData.fire();
  }

  updateStep(stepId: string, status: StepNode['status'], statement?: string) {
    const existing = this.steps.get(stepId) || { stepId, statement: statement || stepId, status: 'queued' };
    existing.status = status;
    if (statement) existing.statement = statement;
    this.steps.set(stepId, existing);
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: StepNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.statement, vscode.TreeItemCollapsibleState.None);
    item.id = element.stepId;

    switch (element.status) {
      case 'queued':
        item.iconPath = new vscode.ThemeIcon('circle-outline');
        break;
      case 'running':
        item.iconPath = new vscode.ThemeIcon('sync~spin');
        break;
      case 'succeeded':
        item.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
        break;
      case 'failed':
        item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
        break;
    }
    return item;
  }

  getChildren(): StepNode[] {
    return Array.from(this.steps.values());
  }
}

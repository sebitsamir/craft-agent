import * as vscode from 'vscode';
import type { FilmReportView } from './filmView.js';

/**
 * Film Sidebar Tree View
 *
 * Renders a loaded film project as a browsable tree:
 *   ▼ Film Project (<type>)
 *       > Timelines (N)
 *       > Media Assets (N)
 *       > Media Links (N)   [linked Correct / missing Wrong]
 *
 * The provider holds the most recent report and re-renders when it changes.
 */

type FilmNodeKind = 'root' | 'section' | 'timeline' | 'media' | 'link';

interface FilmNode {
  readonly kind: FilmNodeKind;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly children?: readonly FilmNode[];
}

export class FilmTreeProvider implements vscode.TreeDataProvider<FilmNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FilmNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private report: FilmReportView | undefined;

  /** Stores a report and refreshes the tree. Pass undefined to clear. */
  setReport(report: FilmReportView | undefined): void {
    this.report = report;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: FilmNode): vscode.TreeItem {
    const hasChildren = (node.children?.length ?? 0) > 0;
    const collapsible =
      node.kind === 'root'
        ? vscode.TreeItemCollapsibleState.Expanded
        : hasChildren
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;

    const item = new vscode.TreeItem(node.label, collapsible);
    if (node.description) item.description = node.description;
    if (node.icon) item.iconPath = new vscode.ThemeIcon(node.icon);
    return item;
  }

  getChildren(node?: FilmNode): FilmNode[] {
    if (!node) {
      if (!this.report) return [];
      return [this.buildRoot(this.report)];
    }
    return [...(node.children ?? [])];
  }

  // -------------------------------------------------------------------------
  // Node builders
  // -------------------------------------------------------------------------

  private buildRoot(r: FilmReportView): FilmNode {
    return {
      kind: 'root',
      label: `Film Project (${r.projectType})`,
      icon: 'folder',
      children: [this.buildTimelines(r), this.buildMedia(r), this.buildLinks(r)],
    };
  }

  private buildTimelines(r: FilmReportView): FilmNode {
    return {
      kind: 'section',
      label: 'Timelines',
      description: `${r.timelines.length}`,
      icon: 'film',
      children: r.timelines.map((t) => ({
        kind: 'timeline' as const,
        label: t.path,
        description: `${t.format} · ${t.referencedClips.length} clips`,
        icon: 'file',
      })),
    };
  }

  private buildMedia(r: FilmReportView): FilmNode {
    return {
      kind: 'section',
      label: 'Media Assets',
      description: `${r.mediaAssets.length}`,
      icon: 'library',
      children: r.mediaAssets.map((m) => ({
        kind: 'media' as const,
        label: m,
        icon: 'file-media',
      })),
    };
  }

  private buildLinks(r: FilmReportView): FilmNode {
    return {
      kind: 'section',
      label: 'Media Links',
      description: `${r.checks.length}`,
      icon: 'link',
      children: r.checks.map((c) => ({
        kind: 'link' as const,
        label: c.clipName,
        description: c.status,
        icon: c.status === 'linked' ? 'pass' : 'error',
      })),
    };
  }
}

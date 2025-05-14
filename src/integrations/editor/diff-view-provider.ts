import * as vscode from 'vscode';

// Define the URI scheme for diff views
export const DIFF_VIEW_URI_SCHEME = 'koder-diff';

/**
 * Provides content for the diff view
 */
export class DiffViewProvider implements vscode.TextDocumentContentProvider {
  private readonly disposables: vscode.Disposable[] = [];
  
  constructor() {
    // Register the provider
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        DIFF_VIEW_URI_SCHEME,
        this
      )
    );
  }
  
  /**
   * Provides the content for the left side of the diff view
   * The URI contains the original content encoded in base64 in the query
   */
  provideTextDocumentContent(uri: vscode.Uri): string {
    // Decode the content from the uri query
    if (!uri.query) {
      return '';
    }
    
    try {
      return Buffer.from(uri.query, 'base64').toString('utf-8');
    } catch (error) {
      console.error('Error decoding diff content', error);
      return '';
    }
  }
  
  /**
   * Cleans up resources
   */
  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}
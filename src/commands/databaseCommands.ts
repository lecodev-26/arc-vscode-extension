import * as vscode from 'vscode';
import { ArcExplorerProvider } from '../providers/arcExplorerProvider';
import type { ArcTreeItem } from '../providers/arcExplorerProvider';
import { ConnectionManager } from '../utils/connectionManager';
import { validateDatabaseName } from '../utils/databaseNames';

/** Database lifecycle commands for the Arc Explorer. */
export class DatabaseCommands {
  constructor(
    private connectionManager: ConnectionManager,
    private explorerProvider: ArcExplorerProvider
  ) {}

  async createDatabase(): Promise<void> {
    const client = this.connectionManager.getActiveClient();
    if (!client) {
      vscode.window.showWarningMessage('Connect to an Arc server before creating a database.');
      return;
    }

    const name = await vscode.window.showInputBox({
      prompt: 'Create an Arc database',
      placeHolder: 'metrics',
      validateInput: validateDatabaseName
    });
    if (name === undefined) {
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Creating database "${name}"...`,
          cancellable: false
        },
        async () => client.createDatabase(name)
      );
      this.explorerProvider.refresh();
      vscode.window.showInformationMessage(`Database "${name}" created.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to create database "${name}": ${message}`);
    }
  }

  async deleteDatabase(treeItem?: ArcTreeItem): Promise<void> {
    const client = this.connectionManager.getActiveClient();
    if (!client) {
      vscode.window.showWarningMessage('Connect to an Arc server before deleting a database.');
      return;
    }

    if (!treeItem || treeItem.contextValue !== 'database') {
      vscode.window.showWarningMessage('Select a database in the Arc Explorer, then choose Delete Database.');
      return;
    }

    const database = treeItem.metadata?.database;
    const validation = typeof database === 'string' ? validateDatabaseName(database) : 'Select a valid database.';
    if (validation) {
      vscode.window.showErrorMessage(validation);
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Delete database "${database}"?`,
      {
        modal: true,
        detail: 'This permanently removes the database and its stored data. This action cannot be undone.'
      },
      'Delete Database'
    );
    if (confirmation !== 'Delete Database') {
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Deleting database "${database}"...`,
          cancellable: false
        },
        async () => client.deleteDatabase(database)
      );
      this.explorerProvider.refresh();
      if (this.connectionManager.getActiveDatabase() === database) {
        vscode.window.showWarningMessage(
          `Database "${database}" was deleted. The active connection still references it; update the connection's database setting before running queries.`
        );
      } else {
        vscode.window.showInformationMessage(`Database "${database}" deleted.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to delete database "${database}": ${message}`);
    }
  }
}

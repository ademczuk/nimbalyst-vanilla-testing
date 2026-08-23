/**
 * OutputWriter - Handles writing automation results to files.
 *
 * Supports three modes:
 * - new-file: Creates a new file for each run using a name template
 * - append: Appends to a single output file with date headers
 * - replace: Overwrites a single output file each run
 */

import type { AutomationStatus } from '../frontmatter/types';

interface ExtensionFileSystem {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  fileExists: (path: string) => Promise<boolean>;
}

export class OutputWriter {
  private fs: ExtensionFileSystem;

  constructor(fs: ExtensionFileSystem) {
    this.fs = fs;
  }

  /**
   * Write automation output according to the configured mode.
   * Returns the path of the file that was written.
   */
  async write(status: AutomationStatus, content: string): Promise<string> {
    const filePath = this.resolveFilePath(status);

    switch (status.output.mode) {
      case 'new-file':
        return this.writeNewFile(filePath, content, status.title);
      case 'append':
        return this.writeAppend(filePath, content, status.title);
      case 'replace':
        return this.writeReplace(filePath, content, status.title);
      default:
        throw new Error(`Unknown output mode: ${status.output.mode}`);
    }
  }

  /**
   * Resolve the file this run writes to. `fileNameTemplate` names the output
   * file in every mode — new-file leans on the placeholders to make each run
   * unique, while append/replace normally use a static name. It used to be read
   * only in new-file mode, so an append/replace automation silently wrote to
   * `output.md` no matter what its frontmatter asked for (#1351).
   */
  private resolveFilePath(status: AutomationStatus): string {
    const { output } = status;
    const template =
      output.fileNameTemplate ?? (output.mode === 'new-file' ? '{{date}}-output.md' : 'output.md');
    const location = output.location.endsWith('/') ? output.location : output.location + '/';
    return location + this.expandTemplate(template, status.id);
  }

  private async writeNewFile(
    filePath: string,
    content: string,
    automationTitle: string,
  ): Promise<string> {
    const fileContent = `# ${automationTitle} - ${new Date().toLocaleDateString()}\n\n${content}\n`;
    await this.fs.writeFile(filePath, fileContent);
    return filePath;
  }

  private async writeAppend(
    filePath: string,
    content: string,
    automationTitle: string,
  ): Promise<string> {
    const dateHeader = `\n---\n\n## ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n\n`;

    let existing = '';
    try {
      if (await this.fs.fileExists(filePath)) {
        existing = await this.fs.readFile(filePath);
      }
    } catch {
      // File doesn't exist yet
    }

    if (!existing) {
      existing = `# ${automationTitle} - Output Log\n`;
    }

    await this.fs.writeFile(filePath, existing + dateHeader + content + '\n');
    return filePath;
  }

  private async writeReplace(
    filePath: string,
    content: string,
    automationTitle: string,
  ): Promise<string> {
    const fileContent = `# ${automationTitle}\n\n*Last updated: ${new Date().toLocaleString()}*\n\n${content}\n`;
    await this.fs.writeFile(filePath, fileContent);
    return filePath;
  }

  private expandTemplate(template: string, automationId: string): string {
    const now = new Date();
    const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS

    return template
      .replace(/\{\{date\}\}/g, date)
      .replace(/\{\{time\}\}/g, time)
      .replace(/\{\{id\}\}/g, automationId);
  }
}

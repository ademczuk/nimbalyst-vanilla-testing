export type FileStatus = 'added' | 'modified' | 'deleted';

export function getStatusLabel(status: FileStatus): string {
  switch (status) {
    case 'added': return 'New file';
    case 'modified': return 'Modified';
    case 'deleted': return 'Deleted';
    default: return 'Modified';
  }
}

export function getStatusColorClass(status: FileStatus): string {
  switch (status) {
    case 'added': return 'text-nim-success';
    case 'modified': return 'text-nim-info';
    case 'deleted': return 'text-nim-error';
    default: return 'text-nim';
  }
}

'use client';
import { 
  FileText, 
  FileImage, 
  FileVideo, 
  FileAudio, 
  FileArchive, 
  FileCode, 
  FileSpreadsheet, 
  FileStack,
  File as FileIconBase,
  FileDigit,
  Presentation
} from 'lucide-react';

interface FileIconProps {
  mimeType: string;
  className?: string;
}

export function FileIcon({ mimeType, className }: FileIconProps) {
  if (mimeType.startsWith('image/')) return <FileImage className={className} />;
  if (mimeType.startsWith('video/')) return <FileVideo className={className} />;
  if (mimeType.startsWith('audio/')) return <FileAudio className={className} />;
  if (mimeType.includes('pdf')) return <FileText className={className} />;
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar') || mimeType.includes('gz')) return <FileArchive className={className} />;
  if (mimeType.includes('word') || mimeType.includes('document')) return <FileText className={className} />;
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return <FileSpreadsheet className={className} />;
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return <Presentation className={className} />;
  if (mimeType.includes('text/')) return <FileText className={className} />;
  if (mimeType.includes('javascript') || mimeType.includes('typescript') || mimeType.includes('python') || mimeType.includes('json')) return <FileCode className={className} />;
  if (mimeType.includes('application/octet-stream')) return <FileDigit className={className} />;
  
  return <FileIconBase className={className} />;
}

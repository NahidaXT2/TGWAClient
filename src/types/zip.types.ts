export interface ExtractionInfo {
  path: string;
  expires_at: string;
  status: 'starting' | 'downloading' | 'extracting' | 'completed' | 'failed';
  created_at: string;
  started_at?: string;
  completed_at?: string;
  base_url: string;
  downloaded_size?: number;
  file_count?: number;
  total_size?: number;
  extraction_successful?: boolean;
}

export interface ExtractedFile {
  filename: string;
  original_filename: string;
  size: number;
  path: string;
  url: string | null;
}

export interface ExtractionResult {
  status: 'success' | 'error';
  extraction_id: string;
  files: ExtractedFile[];
  file_count: number;
  total_size: number;
  downloaded_size: number;
  delete_url: string;
  expires_at: string;
  limits: {
    max_file_size_mb: number;
    max_extraction_size_mb: number;
    max_files: number;
  };
}

export interface ExtractionError {
  status: number;
  message: string;
}

export interface FileDownloadInfo {
  name: string;
  size: number;
  modified: string;
  url: string;
}

export interface BrowseResult {
  extraction_id: string;
  files: FileDownloadInfo[];
  file_count: number;
  total_size: number;
  expires_at: string;
}

export interface ZipLimits {
  max_file_size: number;
  max_extraction_size: number;
  max_files: number;
  file_expiration_hours: number;
}

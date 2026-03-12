/**
 * File gateway client — signed URL operations go through the file-gateway Edge Function.
 */

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

interface FileGatewayOptions {
  authToken?: string; // For internal users
  isPortal?: boolean; // For portal users (uses cookie)
}

async function fileGatewayFetch(
  body: Record<string, unknown>,
  options: FileGatewayOptions = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.authToken) {
    headers["Authorization"] = `Bearer ${options.authToken}`;
  }

  return fetch(`${FUNCTIONS_BASE}/file-gateway`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(body),
  });
}

export interface UploadUrlResult {
  upload_url: string;
  token: string;
  storage_path: string;
  expires_in: number;
}

export async function getSignedUploadUrl(
  params: {
    workspace_id: string;
    owner_type: string;
    owner_id: string;
    file_name: string;
    mime_type: string;
  },
  options: FileGatewayOptions = {}
): Promise<UploadUrlResult> {
  const res = await fileGatewayFetch({ action: "get_upload_url", ...params }, options);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Failed to get upload URL");
  return json;
}

export async function uploadFileToSignedUrl(
  uploadUrl: string,
  token: string,
  file: File
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type,
      "x-upsert": "true",
    },
    body: file,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed: ${text}`);
  }
}

export async function registerFile(
  params: {
    workspace_id: string;
    owner_type: string;
    owner_id: string;
    file_name: string;
    mime_type: string;
    file_size: number;
    storage_path: string;
    description?: string;
  },
  options: FileGatewayOptions = {}
): Promise<{ id: string; file_name: string; created_at: string }> {
  const res = await fileGatewayFetch({ action: "register_file", ...params }, options);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Failed to register file");
  return json.file;
}

export async function getSignedDownloadUrl(
  fileId: string,
  options: FileGatewayOptions = {}
): Promise<{ download_url: string; file_name: string }> {
  const res = await fileGatewayFetch({ action: "get_download_url", file_id: fileId }, options);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Failed to get download URL");
  return json;
}

export async function listFiles(
  params: {
    workspace_id: string;
    owner_type: string;
    owner_id: string;
  },
  options: FileGatewayOptions = {}
): Promise<Array<{ id: string; file_name: string; mime_type: string; file_size: number; description: string | null; created_at: string }>> {
  const res = await fileGatewayFetch({ action: "list_files", ...params }, options);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Failed to list files");
  return json.data;
}

/**
 * Full upload flow: get signed URL → upload → register metadata
 */
export async function uploadFile(
  params: {
    workspace_id: string;
    owner_type: string;
    owner_id: string;
    description?: string;
  },
  file: File,
  options: FileGatewayOptions = {}
): Promise<{ id: string; file_name: string; created_at: string }> {
  // 1. Get signed upload URL
  const uploadResult = await getSignedUploadUrl({
    ...params,
    file_name: file.name,
    mime_type: file.type,
  }, options);

  // 2. Upload file directly to storage
  await uploadFileToSignedUrl(uploadResult.upload_url, uploadResult.token, file);

  // 3. Register file metadata
  return registerFile({
    ...params,
    file_name: file.name,
    mime_type: file.type,
    file_size: file.size,
    storage_path: uploadResult.storage_path,
    description: params.description,
  }, options);
}

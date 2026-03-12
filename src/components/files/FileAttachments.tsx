import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, Download, FileIcon, Trash2, Loader2 } from "lucide-react";
import { uploadFile, listFiles, getSignedDownloadUrl, deleteFile } from "@/lib/file-api";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

interface FileAttachmentsProps {
  workspaceId: string;
  ownerType: string;
  ownerId: string;
  canUpload?: boolean;
  canDelete?: boolean;
}

export function FileAttachments({
  workspaceId,
  ownerType,
  ownerId,
  canUpload = true,
  canDelete = false,
}: FileAttachmentsProps) {
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  const { data: files = [], isLoading } = useQuery({
    queryKey: ["files", workspaceId, ownerType, ownerId],
    queryFn: async () => {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      return listFiles(
        { workspace_id: workspaceId, owner_type: ownerType, owner_id: ownerId },
        { authToken: token }
      );
    },
    enabled: !!workspaceId && !!ownerId,
  });

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      await uploadFile(
        { workspace_id: workspaceId, owner_type: ownerType, owner_id: ownerId },
        file,
        { authToken: token }
      );
      toast.success("File uploaded");
      queryClient.invalidateQueries({ queryKey: ["files", workspaceId, ownerType, ownerId] });
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }, [workspaceId, ownerType, ownerId, queryClient]);

  const handleDownload = useCallback(async (fileId: string) => {
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const { download_url, file_name } = await getSignedDownloadUrl(fileId, { authToken: token });
      const a = document.createElement("a");
      a.href = download_url;
      a.download = file_name;
      a.click();
    } catch (err: any) {
      toast.error(err.message || "Download failed");
    }
  }, []);

  const handleDelete = useCallback(async (fileId: string) => {
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      await deleteFile(fileId, { authToken: token });
      toast.success("File removed");
      queryClient.invalidateQueries({ queryKey: ["files", workspaceId, ownerType, ownerId] });
    } catch {
      toast.error("Delete failed");
    }
  }, [workspaceId, ownerType, ownerId, queryClient]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">Attachments</h4>
        {canUpload && (
          <label className="cursor-pointer">
            <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
            <Button size="sm" variant="outline" asChild disabled={uploading}>
              <span>
                {uploading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
                Upload
              </span>
            </Button>
          </label>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading files…</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-muted-foreground">No files attached.</p>
      ) : (
        <div className="space-y-1">
          {files.map((f) => (
            <div key={f.id} className="flex items-center justify-between rounded border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{f.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(f.file_size)} · {format(new Date(f.created_at), "dd MMM yyyy")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDownload(f.id)}>
                  <Download className="h-3 w-3" />
                </Button>
                {canDelete && (
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(f.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

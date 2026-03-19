import { useEffect, useState, useCallback } from "react";
import type { PortalSessionInfo } from "@/lib/portal-api";
import { portalGetResource, portalAction } from "@/lib/portal-api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, Download, FileText, Image, File } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

interface Props {
  session: PortalSessionInfo;
}

interface PortalFile {
  id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
  owner_type: string;
  description: string | null;
}

const OWNER_LABELS: Record<string, string> = {
  company: "Company",
  invoice: "Invoice",
  project: "Project",
};

function getFileIcon(mime: string) {
  if (mime.startsWith("image/")) return <Image className="h-5 w-5 text-blue-500" />;
  if (mime === "application/pdf") return <FileText className="h-5 w-5 text-red-500" />;
  return <File className="h-5 w-5 text-muted-foreground" />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PortalDocuments({ session: _session }: Props) {
  const [files, setFiles] = useState<PortalFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    const { data } = await portalGetResource<PortalFile[]>("documents");
    setFiles(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const handleDownload = async (file: PortalFile) => {
    setDownloading(file.id);
    try {
      const { data, error } = await portalAction<{ url: string }>("get_document_url", { file_id: file.id });
      if (error) throw new Error(error);
      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (err: any) {
      toast.error(err.message || "Could not download file");
    } finally {
      setDownloading(null);
    }
  };

  if (loading) {
    return <p className="text-center py-8 text-muted-foreground">Loading documents…</p>;
  }

  if (files.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="py-10 text-center">
          <FolderOpen className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
          <h3 className="text-sm font-medium text-foreground mb-1">No documents yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Documents shared with your company will appear here. This includes files attached to your invoices, proposals, and other records.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      <p className="text-sm text-muted-foreground mb-3">
        Files and documents shared with your company. Click download to save a copy.
      </p>
      {files.map((file) => (
        <Card key={file.id}>
          <CardContent className="flex items-center gap-4 py-3">
            <div className="shrink-0">
              {getFileIcon(file.mime_type)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{file.file_name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground">{formatFileSize(file.file_size)}</span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(file.created_at), "dd MMM yyyy")}
                </span>
                <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                  {OWNER_LABELS[file.owner_type] || file.owner_type}
                </Badge>
              </div>
              {file.description && (
                <p className="text-xs text-muted-foreground mt-1">{file.description}</p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDownload(file)}
              disabled={downloading === file.id}
              className="shrink-0"
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              {downloading === file.id ? "…" : "Download"}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

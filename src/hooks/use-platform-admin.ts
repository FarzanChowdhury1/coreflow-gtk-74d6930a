import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function usePlatformAdmin() {
  const { user } = useAuth();
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checkedUserId, setCheckedUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setIsPlatformAdmin(false);
      setCheckedUserId(null);
      setLoading(false);
      return;
    }

    // Reset loading when user changes to prevent premature redirect
    setLoading(true);
    setCheckedUserId(null);
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("platform_admins" as any)
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!cancelled) {
        setIsPlatformAdmin(!error && !!data);
        setCheckedUserId(user.id);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  return {
    isPlatformAdmin,
    loading: loading || (!!user && checkedUserId !== user.id),
  };
}

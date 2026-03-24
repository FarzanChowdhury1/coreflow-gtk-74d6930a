import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function usePlatformAdmin() {
  const { user } = useAuth();
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsPlatformAdmin(false);
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("platform_admins" as any)
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!cancelled) {
        setIsPlatformAdmin(!error && !!data);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  return { isPlatformAdmin, loading };
}

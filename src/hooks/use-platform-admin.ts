import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function usePlatformAdmin() {
  const { user } = useAuth();
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const checkedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      setIsPlatformAdmin(false);
      checkedRef.current = null;
      setLoading(false);
      return;
    }

    if (checkedRef.current === user.id) return;

    setLoading(true);
    let cancelled = false;

    supabase
      .from("platform_admins" as any)
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setIsPlatformAdmin(!error && !!data);
        checkedRef.current = user.id;
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [user?.id]);

  return { isPlatformAdmin, loading };
}

import { useEffect, useRef, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function usePlatformAdmin() {
  const { user } = useAuth();
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [checked, setChecked] = useState(false);
  const checkedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      setIsPlatformAdmin(false);
      checkedRef.current = null;
      setChecked(false);
      return;
    }

    if (checkedRef.current === user.id) return;

    setChecked(false);
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
        setChecked(true);
      });

    return () => { cancelled = true; };
  }, [user?.id]);

  // loading = true when user exists but we haven't verified yet
  const loading = useMemo(() => {
    if (!user) return false;
    return !checked || checkedRef.current !== user.id;
  }, [user, checked]);

  return { isPlatformAdmin, loading };
}

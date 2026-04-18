DO $$
DECLARE _ws uuid;
BEGIN
  FOR _ws IN SELECT id FROM workspaces WHERE name LIKE 'fa-exact-path-%' LOOP
    DELETE FROM payments              WHERE workspace_id = _ws;
    DELETE FROM expenses              WHERE workspace_id = _ws;
    DELETE FROM budgets               WHERE workspace_id = _ws;
    DELETE FROM invoice_line_items    WHERE workspace_id = _ws;
    DELETE FROM invoices              WHERE workspace_id = _ws;
    DELETE FROM vendors               WHERE workspace_id = _ws;
    DELETE FROM contacts              WHERE workspace_id = _ws;
    DELETE FROM companies             WHERE workspace_id = _ws;
    DELETE FROM workspace_memberships WHERE workspace_id = _ws;
    DELETE FROM audit_logs            WHERE workspace_id = _ws;
    DELETE FROM workspaces            WHERE id = _ws;
  END LOOP;
END $$;
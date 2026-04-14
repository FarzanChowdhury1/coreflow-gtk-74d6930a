export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      approval_actions: {
        Row: {
          acted_at: string
          actor_id: string
          comment: string | null
          decision: Database["public"]["Enums"]["approval_status"]
          id: string
          request_id: string
          step_order: number
          workspace_id: string
        }
        Insert: {
          acted_at?: string
          actor_id: string
          comment?: string | null
          decision: Database["public"]["Enums"]["approval_status"]
          id?: string
          request_id: string
          step_order: number
          workspace_id: string
        }
        Update: {
          acted_at?: string
          actor_id?: string
          comment?: string | null
          decision?: Database["public"]["Enums"]["approval_status"]
          id?: string
          request_id?: string
          step_order?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_actions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_actions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          created_at: string
          current_step: number
          entity_id: string
          entity_type: Database["public"]["Enums"]["approvable_type"]
          id: string
          requested_by: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          current_step?: number
          entity_id: string
          entity_type: Database["public"]["Enums"]["approvable_type"]
          id?: string
          requested_by: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
          workflow_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          current_step?: number
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["approvable_type"]
          id?: string
          requested_by?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "approval_workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_steps: {
        Row: {
          approver_id: string
          created_at: string
          id: string
          step_order: number
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          approver_id: string
          created_at?: string
          id?: string
          step_order?: number
          workflow_id: string
          workspace_id: string
        }
        Update: {
          approver_id?: string
          created_at?: string
          id?: string
          step_order?: number
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_steps_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "approval_workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_steps_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_workflows: {
        Row: {
          created_at: string
          entity_type: Database["public"]["Enums"]["approvable_type"]
          id: string
          is_active: boolean
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          entity_type: Database["public"]["Enums"]["approvable_type"]
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          entity_type?: Database["public"]["Enums"]["approvable_type"]
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_workflows_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          workspace_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          workspace_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      beta_feedback: {
        Row: {
          category: Database["public"]["Enums"]["feedback_category"]
          created_at: string
          current_route: string | null
          description: string | null
          file_id: string | null
          founder_notes: string | null
          id: string
          priority: string
          status: Database["public"]["Enums"]["feedback_status"]
          submitted_by: string
          submitter_role: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["feedback_category"]
          created_at?: string
          current_route?: string | null
          description?: string | null
          file_id?: string | null
          founder_notes?: string | null
          id?: string
          priority?: string
          status?: Database["public"]["Enums"]["feedback_status"]
          submitted_by: string
          submitter_role?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          category?: Database["public"]["Enums"]["feedback_category"]
          created_at?: string
          current_route?: string | null
          description?: string | null
          file_id?: string | null
          founder_notes?: string | null
          id?: string
          priority?: string
          status?: Database["public"]["Enums"]["feedback_status"]
          submitted_by?: string
          submitter_role?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "beta_feedback_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beta_feedback_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          category: string
          created_at: string
          currency: string
          id: string
          notes: string | null
          period_end: string
          period_start: string
          target_amount: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          category: string
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          period_end: string
          period_start: string
          target_amount?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          category?: string
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          period_end?: string
          period_start?: string
          target_amount?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tasks: {
        Row: {
          approved_at: string | null
          company_id: string
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          id: string
          project_id: string | null
          response_link: string | null
          response_notes: string | null
          response_text: string | null
          revision_note: string | null
          sort_order: number
          status: Database["public"]["Enums"]["client_task_status"]
          submitted_at: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          approved_at?: string | null
          company_id: string
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          id?: string
          project_id?: string | null
          response_link?: string | null
          response_notes?: string | null
          response_text?: string | null
          revision_note?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["client_task_status"]
          submitted_at?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          approved_at?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          id?: string
          project_id?: string | null
          response_link?: string | null
          response_notes?: string | null
          response_text?: string | null
          revision_note?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["client_task_status"]
          submitted_at?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_updates: {
        Row: {
          author_id: string
          body: string | null
          company_id: string
          created_at: string
          deleted_at: string | null
          file_id: string | null
          id: string
          is_published: boolean
          project_id: string
          published_at: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_id: string
          body?: string | null
          company_id: string
          created_at?: string
          deleted_at?: string | null
          file_id?: string | null
          id?: string
          is_published?: boolean
          project_id: string
          published_at?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_id?: string
          body?: string | null
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          file_id?: string | null
          id?: string
          is_published?: boolean
          project_id?: string
          published_at?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_updates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_updates_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_updates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_updates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          bin: string | null
          created_at: string
          deleted_at: string | null
          id: string
          legal_name: string
          notes: string | null
          owner_id: string | null
          phone: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          address?: string | null
          bin?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          legal_name: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          address?: string | null
          bin?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          legal_name?: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      company_access: {
        Row: {
          company_id: string
          created_at: string
          granted_by: string | null
          id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          granted_by?: string | null
          id?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          granted_by?: string | null
          id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_access_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_access_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          alt_phone: string | null
          company_id: string | null
          created_at: string
          deleted_at: string | null
          designation: string | null
          email: string | null
          full_name: string
          id: string
          notes: string | null
          phone: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          alt_phone?: string | null
          company_id?: string | null
          created_at?: string
          deleted_at?: string | null
          designation?: string | null
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          alt_phone?: string | null
          company_id?: string | null
          created_at?: string
          deleted_at?: string | null
          designation?: string | null
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      digest_runs: {
        Row: {
          error_message: string | null
          executed_at: string
          id: string
          mode: string
          overdue_followups_count: number
          overdue_invoices_count: number
          status: string
          triggered_by: string
          upcoming_renewals_count: number
          workspace_id: string
        }
        Insert: {
          error_message?: string | null
          executed_at?: string
          id?: string
          mode?: string
          overdue_followups_count?: number
          overdue_invoices_count?: number
          status?: string
          triggered_by: string
          upcoming_renewals_count?: number
          workspace_id: string
        }
        Update: {
          error_message?: string | null
          executed_at?: string
          id?: string
          mode?: string
          overdue_followups_count?: number
          overdue_invoices_count?: number
          status?: string
          triggered_by?: string
          upcoming_renewals_count?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "digest_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_logs: {
        Row: {
          created_at: string
          email_type: string
          entity_id: string | null
          entity_type: string | null
          error_message: string | null
          id: string
          metadata: Json | null
          provider_message_id: string | null
          recipient_email: string
          status: string
          subject: string | null
          triggered_by: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          email_type: string
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          provider_message_id?: string | null
          recipient_email: string
          status?: string
          subject?: string | null
          triggered_by?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          email_type?: string
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          provider_message_id?: string | null
          recipient_email?: string
          status?: string
          subject?: string | null
          triggered_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          description: string
          expense_date: string
          id: string
          notes: string | null
          paid_date: string | null
          payment_method: string | null
          payment_status: string
          project_id: string | null
          recorded_by: string
          updated_at: string
          vendor_id: string | null
          workspace_id: string
        }
        Insert: {
          amount?: number
          category?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          description: string
          expense_date?: string
          id?: string
          notes?: string | null
          paid_date?: string | null
          payment_method?: string | null
          payment_status?: string
          project_id?: string | null
          recorded_by: string
          updated_at?: string
          vendor_id?: string | null
          workspace_id: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          description?: string
          expense_date?: string
          id?: string
          notes?: string | null
          paid_date?: string | null
          payment_method?: string | null
          payment_status?: string
          project_id?: string | null
          recorded_by?: string
          updated_at?: string
          vendor_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          file_name: string
          file_size: number
          id: string
          mime_type: string
          owner_id: string
          owner_type: string
          storage_path: string
          updated_at: string
          uploaded_by: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          file_name: string
          file_size?: number
          id?: string
          mime_type: string
          owner_id: string
          owner_type: string
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          file_name?: string
          file_size?: number
          id?: string
          mime_type?: string
          owner_id?: string
          owner_type?: string
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "files_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          invoice_id: string
          quantity: number
          sort_order: number
          unit_price: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          quantity?: number
          sort_order?: number
          unit_price?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          quantity?: number
          sort_order?: number
          unit_price?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_sequences: {
        Row: {
          last_number: number
          workspace_id: string
        }
        Insert: {
          last_number?: number
          workspace_id: string
        }
        Update: {
          last_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_sequences_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_paid: number
          company_id: string
          created_at: string
          currency: string
          deleted_at: string | null
          due_date: string | null
          grand_total: number
          id: string
          invoice_number: string
          issue_date: string | null
          mushak_6_3: Json
          notes: string | null
          project_id: string | null
          proposal_version_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tax_config: Json
          tax_total: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount_paid?: number
          company_id: string
          created_at?: string
          currency?: string
          deleted_at?: string | null
          due_date?: string | null
          grand_total?: number
          id?: string
          invoice_number: string
          issue_date?: string | null
          mushak_6_3?: Json
          notes?: string | null
          project_id?: string | null
          proposal_version_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_config?: Json
          tax_total?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount_paid?: number
          company_id?: string
          created_at?: string
          currency?: string
          deleted_at?: string | null
          due_date?: string | null
          grand_total?: number
          id?: string
          invoice_number?: string
          issue_date?: string | null
          mushak_6_3?: Json
          notes?: string | null
          project_id?: string | null
          proposal_version_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_config?: Json
          tax_total?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_proposal_version_id_fkey"
            columns: ["proposal_version_id"]
            isOneToOne: false
            referencedRelation: "latest_proposal_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_proposal_version_id_fkey"
            columns: ["proposal_version_id"]
            isOneToOne: false
            referencedRelation: "proposal_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          id: string
          lead_id: string
          status: Database["public"]["Enums"]["lead_task_status"]
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          id?: string
          lead_id: string
          status?: Database["public"]["Enums"]["lead_task_status"]
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          id?: string
          lead_id?: string
          status?: Database["public"]["Enums"]["lead_task_status"]
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          company_id: string | null
          contact_id: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          estimated_value: number | null
          id: string
          last_contacted_at: string | null
          next_follow_up: string | null
          notes: string | null
          owner_id: string | null
          source: string | null
          status: Database["public"]["Enums"]["lead_status"]
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          estimated_value?: number | null
          id?: string
          last_contacted_at?: string | null
          next_follow_up?: string | null
          notes?: string | null
          owner_id?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          estimated_value?: number | null
          id?: string
          last_contacted_at?: string | null
          next_follow_up?: string | null
          notes?: string | null
          owner_id?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_actions: {
        Row: {
          action_type: string
          assignee_id: string | null
          created_at: string
          due_date: string | null
          id: string
          meeting_id: string
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          action_type?: string
          assignee_id?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          meeting_id: string
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          action_type?: string
          assignee_id?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          meeting_id?: string
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_actions_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_actions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          attendees: string | null
          company_id: string | null
          contact_id: string | null
          created_at: string
          created_by: string
          description: string | null
          ends_at: string | null
          id: string
          lead_id: string | null
          location: string | null
          meeting_type: Database["public"]["Enums"]["meeting_type"]
          minutes: string | null
          project_id: string | null
          starts_at: string
          status: Database["public"]["Enums"]["meeting_status"]
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          attendees?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          ends_at?: string | null
          id?: string
          lead_id?: string | null
          location?: string | null
          meeting_type?: Database["public"]["Enums"]["meeting_type"]
          minutes?: string | null
          project_id?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["meeting_status"]
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          attendees?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          lead_id?: string | null
          location?: string | null
          meeting_type?: Database["public"]["Enums"]["meeting_type"]
          minutes?: string | null
          project_id?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["meeting_status"]
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          severity: string
          title: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          severity?: string
          title: string
          user_id: string
          workspace_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          severity?: string
          title?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          paid_at: string
          proof_url: string | null
          recorded_by: string
          reference: string | null
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          invoice_id: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_at?: string
          proof_url?: string | null
          recorded_by: string
          reference?: string | null
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          invoice_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_at?: string
          proof_url?: string | null
          recorded_by?: string
          reference?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      portal_failed_attempts: {
        Row: {
          attempted_at: string
          id: string
          ip_address: string
        }
        Insert: {
          attempted_at?: string
          id?: string
          ip_address: string
        }
        Update: {
          attempted_at?: string
          id?: string
          ip_address?: string
        }
        Relationships: []
      }
      portal_tokens: {
        Row: {
          company_id: string
          consumed_at: string | null
          contact_id: string
          created_at: string
          expires_at: string
          id: string
          revoked_at: string | null
          token: string
          workspace_id: string
        }
        Insert: {
          company_id: string
          consumed_at?: string | null
          contact_id: string
          created_at?: string
          expires_at: string
          id?: string
          revoked_at?: string | null
          token?: string
          workspace_id: string
        }
        Update: {
          company_id?: string
          consumed_at?: string | null
          contact_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_tokens_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_tokens_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_tokens_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      product_events: {
        Row: {
          created_at: string
          event_name: string
          id: string
          metadata: Json | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          event_name: string
          id?: string
          metadata?: Json | null
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          event_name?: string
          id?: string
          metadata?: Json | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          created_at: string
          id: string
          project_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          company_id: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          proposal_version_id: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          target_end_date: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          proposal_version_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_end_date?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          proposal_version_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_end_date?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_proposal_version_id_fkey"
            columns: ["proposal_version_id"]
            isOneToOne: false
            referencedRelation: "latest_proposal_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_proposal_version_id_fkey"
            columns: ["proposal_version_id"]
            isOneToOne: false
            referencedRelation: "proposal_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_line_items: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          quantity: number
          sort_order: number
          unit_price: number
          updated_at: string
          version_id: string
          workspace_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          description: string
          id?: string
          quantity?: number
          sort_order?: number
          unit_price?: number
          updated_at?: string
          version_id: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          quantity?: number
          sort_order?: number
          unit_price?: number
          updated_at?: string
          version_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_line_items_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "latest_proposal_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_line_items_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "proposal_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_line_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_versions: {
        Row: {
          created_at: string
          currency: string
          grand_total: number
          id: string
          notes: string | null
          proposal_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["proposal_version_status"]
          subtotal: number
          tax_config: Json
          tax_total: number
          updated_at: string
          valid_until: string | null
          version_number: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          grand_total?: number
          id?: string
          notes?: string | null
          proposal_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["proposal_version_status"]
          subtotal?: number
          tax_config?: Json
          tax_total?: number
          updated_at?: string
          valid_until?: string | null
          version_number?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          grand_total?: number
          id?: string
          notes?: string | null
          proposal_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["proposal_version_status"]
          subtotal?: number
          tax_config?: Json
          tax_total?: number
          updated_at?: string
          valid_until?: string | null
          version_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_versions_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          company_id: string
          created_at: string
          deleted_at: string | null
          id: string
          lead_id: string | null
          notes: string | null
          owner_id: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          owner_id?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          owner_id?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      renewals: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          currency: string
          id: string
          interval_months: number
          invoice_id: string | null
          is_active: boolean
          label: string
          last_generated_billing_date: string | null
          next_billing_date: string
          notes: string | null
          project_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount?: number
          company_id: string
          created_at?: string
          currency?: string
          id?: string
          interval_months?: number
          invoice_id?: string | null
          is_active?: boolean
          label: string
          last_generated_billing_date?: string | null
          next_billing_date: string
          notes?: string | null
          project_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          currency?: string
          id?: string
          interval_months?: number
          invoice_id?: string | null
          is_active?: boolean
          label?: string
          last_generated_billing_date?: string | null
          next_billing_date?: string
          notes?: string | null
          project_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "renewals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renewals_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renewals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renewals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      short_links: {
        Row: {
          click_count: number
          code: string
          context_id: string | null
          context_type: string | null
          created_at: string
          expires_at: string
          id: string
          target_url: string
          workspace_id: string
        }
        Insert: {
          click_count?: number
          code?: string
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          expires_at: string
          id?: string
          target_url: string
          workspace_id: string
        }
        Update: {
          click_count?: number
          code?: string
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          target_url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "short_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          currency: string
          id: string
          interval_months: number
          is_active: boolean
          name: string
          next_billing_date: string
          notes: string | null
          updated_at: string
          vendor_id: string | null
          workspace_id: string
        }
        Insert: {
          amount?: number
          category?: string | null
          created_at?: string
          currency?: string
          id?: string
          interval_months?: number
          is_active?: boolean
          name: string
          next_billing_date: string
          notes?: string | null
          updated_at?: string
          vendor_id?: string | null
          workspace_id: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          currency?: string
          id?: string
          interval_months?: number
          is_active?: boolean
          name?: string
          next_billing_date?: string
          notes?: string | null
          updated_at?: string
          vendor_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      system_alerts: {
        Row: {
          alert_type: string
          body: string | null
          created_at: string
          dismissed_at: string | null
          entity_id: string
          entity_type: string
          id: string
          is_dismissed: boolean
          severity: string
          sweep_key: string
          title: string
          workspace_id: string
        }
        Insert: {
          alert_type: string
          body?: string | null
          created_at?: string
          dismissed_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          is_dismissed?: boolean
          severity?: string
          sweep_key: string
          title: string
          workspace_id: string
        }
        Update: {
          alert_type?: string
          body?: string | null
          created_at?: string
          dismissed_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          is_dismissed?: boolean
          severity?: string
          sweep_key?: string
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_alerts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          priority: Database["public"]["Enums"]["task_priority"]
          project_id: string
          sort_order: number
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id: string
          sort_order?: number
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          id: string
          team_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          team_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          team_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          department_id: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          category: string | null
          contact_name: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          category?: string | null
          contact_name?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          category?: string | null
          contact_name?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendors_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_runs: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_message: string | null
          finished_at: string | null
          id: string
          started_at: string
          status: string
          summary: Json | null
          trigger_source: string
          triggered_by: string | null
          worker_name: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          summary?: Json | null
          trigger_source?: string
          triggered_by?: string | null
          worker_name: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          summary?: Json | null
          trigger_source?: string
          triggered_by?: string | null
          worker_name?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_followup_notes: {
        Row: {
          author_id: string
          created_at: string
          followup_id: string
          id: string
          note: string
        }
        Insert: {
          author_id: string
          created_at?: string
          followup_id: string
          id?: string
          note: string
        }
        Update: {
          author_id?: string
          created_at?: string
          followup_id?: string
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_followup_notes_followup_id_fkey"
            columns: ["followup_id"]
            isOneToOne: false
            referencedRelation: "workspace_followups"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_followups: {
        Row: {
          created_at: string
          id: string
          last_contacted_at: string | null
          next_followup_date: string | null
          owner_id: string | null
          priority: string | null
          stage: Database["public"]["Enums"]["workspace_commercial_stage"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_contacted_at?: string | null
          next_followup_date?: string | null
          owner_id?: string | null
          priority?: string | null
          stage?: Database["public"]["Enums"]["workspace_commercial_stage"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_contacted_at?: string | null
          next_followup_date?: string | null
          owner_id?: string | null
          priority?: string | null
          stage?: Database["public"]["Enums"]["workspace_commercial_stage"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_followups_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          token: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_memberships: {
        Row: {
          created_at: string
          department_id: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_memberships_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_memberships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          billing_owner_id: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          id: string
          name: string
          plan: string
          seat_limit: number
          timezone: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          billing_owner_id?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          id?: string
          name: string
          plan?: string
          seat_limit?: number
          timezone?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_owner_id?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          id?: string
          name?: string
          plan?: string
          seat_limit?: number
          timezone?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      latest_proposal_versions: {
        Row: {
          created_at: string | null
          currency: string | null
          grand_total: number | null
          id: string | null
          proposal_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["proposal_version_status"] | null
          version_number: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposal_versions_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _generate_renewal_invoice_internal: {
        Args: { _actor_id?: string; _renewal_id: string }
        Returns: Json
      }
      accept_invite_by_token: { Args: { _token: string }; Returns: Json }
      accept_workspace_invite: { Args: { _invite_id: string }; Returns: Json }
      aggregate_daily_digest: { Args: never; Returns: Json }
      aggregate_daily_digest_for_workspace: {
        Args: { _workspace_id: string }
        Returns: Json
      }
      bootstrap_workspace: {
        Args: { _name?: string; _user_id: string }
        Returns: Json
      }
      count_portal_tokens: { Args: { _workspace_id: string }; Returns: number }
      count_retention_candidates_notifications: { Args: never; Returns: Json }
      count_retention_candidates_ops_logs: { Args: never; Returns: Json }
      create_project_from_approved_version: {
        Args: {
          _created_by: string
          _proposal_version_id: string
          _workspace_id: string
        }
        Returns: string
      }
      create_short_link: {
        Args: {
          _context_id?: string
          _context_type?: string
          _target_url: string
          _ttl_days?: number
          _workspace_id: string
        }
        Returns: Json
      }
      create_worker_failure_alert: {
        Args: { _error_summary?: string; _worker_name: string }
        Returns: undefined
      }
      create_workspace_invite: {
        Args: {
          _email: string
          _role?: Database["public"]["Enums"]["app_role"]
          _workspace_id: string
        }
        Returns: Json
      }
      decline_workspace_invite: { Args: { _invite_id: string }; Returns: Json }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      dismiss_system_alert: { Args: { _alert_id: string }; Returns: Json }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      fetch_prioritized_notifications:
        | {
            Args: { _limit?: number; _user_id: string; _workspace_id?: string }
            Returns: {
              body: string | null
              created_at: string
              id: string
              is_read: boolean
              link: string | null
              severity: string
              title: string
              user_id: string
              workspace_id: string
            }[]
            SetofOptions: {
              from: "*"
              to: "notifications"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: { _limit?: number; _user_id: string }
            Returns: {
              body: string | null
              created_at: string
              id: string
              is_read: boolean
              link: string | null
              severity: string
              title: string
              user_id: string
              workspace_id: string
            }[]
            SetofOptions: {
              from: "*"
              to: "notifications"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      generate_due_renewal_invoices: { Args: never; Returns: Json }
      generate_portal_token: {
        Args: {
          _company_id: string
          _contact_id: string
          _expires_in_days?: number
          _workspace_id: string
        }
        Returns: Json
      }
      generate_renewal_invoice: {
        Args: { _renewal_id: string; _workspace_id: string }
        Returns: Json
      }
      get_billing_owner: { Args: { _workspace_id: string }; Returns: Json }
      get_dashboard_financials: {
        Args: { _workspace_id: string }
        Returns: Json
      }
      get_dashboard_metrics: { Args: { _workspace_id: string }; Returns: Json }
      get_onboarding_counts: { Args: { _workspace_id: string }; Returns: Json }
      global_search: {
        Args: { _limit?: number; _term: string; _workspace_id: string }
        Returns: Json
      }
      has_company_access: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      has_workspace_access: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      has_workspace_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
          _workspace_id: string
        }
        Returns: boolean
      }
      invoke_asset_cleanup: { Args: never; Returns: undefined }
      invoke_daily_digest: { Args: never; Returns: undefined }
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean }
      is_project_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      issue_invoice: {
        Args: { _invoice_id: string; _line_items: Json; _workspace_id: string }
        Returns: Json
      }
      manage_renewal: {
        Args: {
          _action: string
          _amount?: number
          _company_id?: string
          _currency?: string
          _interval_months?: number
          _is_active?: boolean
          _label?: string
          _next_billing_date?: string
          _notes?: string
          _project_id?: string
          _renewal_id?: string
          _workspace_id: string
        }
        Returns: Json
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      next_client_task_order: {
        Args: { _company_id: string; _workspace_id: string }
        Returns: number
      }
      next_invoice_number: { Args: { _workspace_id: string }; Returns: string }
      normalize_client_task_order: {
        Args: { _company_id: string; _workspace_id: string }
        Returns: undefined
      }
      platform_workspace_overview: { Args: never; Returns: Json }
      portal_respond_proposal: {
        Args: { _action: string; _token: string; _version_id: string }
        Returns: Json
      }
      portal_respond_proposal_internal: {
        Args: {
          _action: string
          _company_id: string
          _version_id: string
          _workspace_id: string
        }
        Returns: Json
      }
      process_approval_decision: {
        Args: { _comment?: string; _decision: string; _request_id: string }
        Returns: Json
      }
      purge_expired_portal_tokens: { Args: never; Returns: Json }
      purge_expired_short_links: { Args: never; Returns: Json }
      purge_old_notifications: { Args: never; Returns: Json }
      purge_operational_logs: { Args: never; Returns: Json }
      purge_stale_file_rows: { Args: never; Returns: Json }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      resolve_invite_by_token: { Args: { _token: string }; Returns: Json }
      retention_days_notification: {
        Args: { _severity: string }
        Returns: number
      }
      retention_days_ops_log: { Args: { _log_type: string }; Returns: number }
      revoke_workspace_invite: { Args: { _invite_id: string }; Returns: Json }
      select_retention_candidates: { Args: never; Returns: Json }
      set_billing_owner: {
        Args: { _new_owner_id: string; _workspace_id: string }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      start_growth_trial: { Args: { _workspace_id: string }; Returns: Json }
      submit_for_approval: {
        Args: {
          _entity_id: string
          _entity_type: string
          _workspace_id: string
        }
        Returns: Json
      }
      swap_client_task_order: {
        Args: { _task_a: string; _task_b: string }
        Returns: undefined
      }
      sweep_lead_followups: { Args: never; Returns: Json }
      sweep_overdue_invoices: { Args: never; Returns: Json }
      sweep_renewal_reminders: { Args: never; Returns: Json }
      validate_portal_token: { Args: { _token: string }; Returns: Json }
      void_invoice: {
        Args: { _invoice_id: string; _workspace_id: string }
        Returns: Json
      }
      void_proposal_version: {
        Args: { _version_id: string; _workspace_id: string }
        Returns: Json
      }
      workspace_has_members: {
        Args: { _workspace_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "team_member"
      approvable_type: "proposal_version" | "invoice" | "project"
      approval_status: "pending" | "approved" | "rejected" | "cancelled"
      client_task_status:
        | "todo"
        | "submitted"
        | "approved"
        | "revision_requested"
      feedback_category:
        | "bug"
        | "ui_ux"
        | "feature_request"
        | "performance"
        | "other"
      feedback_status: "new" | "reviewed" | "accepted" | "closed"
      invoice_status: "draft" | "issued" | "paid" | "partially_paid" | "void"
      lead_status:
        | "new"
        | "contacted"
        | "qualified"
        | "unqualified"
        | "converted"
      lead_task_status: "todo" | "in_progress" | "done" | "blocked"
      meeting_status: "scheduled" | "completed" | "cancelled"
      meeting_type: "internal" | "client"
      payment_method:
        | "bank_transfer"
        | "cash"
        | "cheque"
        | "mobile_banking"
        | "other"
      project_status: "active" | "on_hold" | "completed" | "cancelled"
      proposal_version_status:
        | "draft"
        | "sent"
        | "approved"
        | "rejected"
        | "voided"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_status: "todo" | "in_progress" | "review" | "done"
      workspace_commercial_stage:
        | "new"
        | "trialing"
        | "activated_free"
        | "expansion_opportunity"
        | "trial_expired"
        | "follow_up_needed"
        | "converted_manual"
        | "enterprise_pipeline"
        | "churn_risk"
        | "inactive"
        | "closed_lost"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "team_member"],
      approvable_type: ["proposal_version", "invoice", "project"],
      approval_status: ["pending", "approved", "rejected", "cancelled"],
      client_task_status: [
        "todo",
        "submitted",
        "approved",
        "revision_requested",
      ],
      feedback_category: [
        "bug",
        "ui_ux",
        "feature_request",
        "performance",
        "other",
      ],
      feedback_status: ["new", "reviewed", "accepted", "closed"],
      invoice_status: ["draft", "issued", "paid", "partially_paid", "void"],
      lead_status: [
        "new",
        "contacted",
        "qualified",
        "unqualified",
        "converted",
      ],
      lead_task_status: ["todo", "in_progress", "done", "blocked"],
      meeting_status: ["scheduled", "completed", "cancelled"],
      meeting_type: ["internal", "client"],
      payment_method: [
        "bank_transfer",
        "cash",
        "cheque",
        "mobile_banking",
        "other",
      ],
      project_status: ["active", "on_hold", "completed", "cancelled"],
      proposal_version_status: [
        "draft",
        "sent",
        "approved",
        "rejected",
        "voided",
      ],
      task_priority: ["low", "medium", "high", "urgent"],
      task_status: ["todo", "in_progress", "review", "done"],
      workspace_commercial_stage: [
        "new",
        "trialing",
        "activated_free",
        "expansion_opportunity",
        "trial_expired",
        "follow_up_needed",
        "converted_manual",
        "enterprise_pipeline",
        "churn_risk",
        "inactive",
        "closed_lost",
      ],
    },
  },
} as const

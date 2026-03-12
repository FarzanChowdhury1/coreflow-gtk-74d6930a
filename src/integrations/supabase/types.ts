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
          bin: string
          created_at: string
          deleted_at: string | null
          id: string
          legal_name: string
          notes: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          address?: string | null
          bin: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          legal_name: string
          notes?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          address?: string | null
          bin?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          legal_name?: string
          notes?: string | null
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
      contacts: {
        Row: {
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
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          link: string | null
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
          company_id: string
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
          company_id: string
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
          company_id?: string
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
          notes: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
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
      workspace_memberships: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
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
          created_at: string
          currency: string
          deleted_at: string | null
          id: string
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          deleted_at?: string | null
          id?: string
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          deleted_at?: string | null
          id?: string
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      aggregate_daily_digest: { Args: never; Returns: Json }
      bootstrap_workspace: {
        Args: { _name?: string; _user_id: string }
        Returns: Json
      }
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
      dismiss_system_alert: { Args: { _alert_id: string }; Returns: Json }
      get_dashboard_metrics: { Args: { _workspace_id: string }; Returns: Json }
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
      is_project_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
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
      next_invoice_number: { Args: { _workspace_id: string }; Returns: string }
      portal_respond_proposal: {
        Args: { _action: string; _token: string; _version_id: string }
        Returns: Json
      }
      process_approval_decision: {
        Args: { _comment?: string; _decision: string; _request_id: string }
        Returns: Json
      }
      purge_expired_portal_tokens: { Args: never; Returns: Json }
      purge_expired_short_links: { Args: never; Returns: Json }
      purge_stale_file_rows: { Args: never; Returns: Json }
      select_retention_candidates: { Args: never; Returns: Json }
      submit_for_approval: {
        Args: {
          _entity_id: string
          _entity_type: string
          _workspace_id: string
        }
        Returns: Json
      }
      sweep_lead_followups: { Args: never; Returns: Json }
      sweep_overdue_invoices: { Args: never; Returns: Json }
      sweep_renewal_reminders: { Args: never; Returns: Json }
      validate_portal_token: { Args: { _token: string }; Returns: Json }
      workspace_has_members: {
        Args: { _workspace_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "team_member"
      approvable_type: "proposal_version" | "invoice" | "project"
      approval_status: "pending" | "approved" | "rejected" | "cancelled"
      invoice_status: "draft" | "issued" | "paid" | "partially_paid" | "void"
      lead_status:
        | "new"
        | "contacted"
        | "qualified"
        | "unqualified"
        | "converted"
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
      invoice_status: ["draft", "issued", "paid", "partially_paid", "void"],
      lead_status: [
        "new",
        "contacted",
        "qualified",
        "unqualified",
        "converted",
      ],
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
    },
  },
} as const

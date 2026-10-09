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
    PostgrestVersion: "14.17"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      einvoice_docs: {
        Row: {
          cess: number
          cgst: number
          client_id: string
          ctin: string
          doc_date: string | null
          doc_key: string
          doc_no: string
          doc_type: string
          doc_value: number
          first_seen_at: string
          id: string
          igst: number
          inv_typ: string | null
          irn: string
          irn_date: string | null
          last_seen_at: string
          period_month: string
          pos: string | null
          raw: Json | null
          section: string
          sgst: number
          source: string
          taxable: number
        }
        Insert: {
          cess?: number
          cgst?: number
          client_id: string
          ctin?: string
          doc_date?: string | null
          doc_key: string
          doc_no: string
          doc_type: string
          doc_value?: number
          first_seen_at?: string
          id?: string
          igst?: number
          inv_typ?: string | null
          irn: string
          irn_date?: string | null
          last_seen_at?: string
          period_month: string
          pos?: string | null
          raw?: Json | null
          section: string
          sgst?: number
          source?: string
          taxable?: number
        }
        Update: {
          cess?: number
          cgst?: number
          client_id?: string
          ctin?: string
          doc_date?: string | null
          doc_key?: string
          doc_no?: string
          doc_type?: string
          doc_value?: number
          first_seen_at?: string
          id?: string
          igst?: number
          inv_typ?: string | null
          irn?: string
          irn_date?: string | null
          last_seen_at?: string
          period_month?: string
          pos?: string | null
          raw?: Json | null
          section?: string
          sgst?: number
          source?: string
          taxable?: number
        }
        Relationships: [
          {
            foreignKeyName: "einvoice_docs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      einvoice_pulls: {
        Row: {
          client_id: string
          docs_found: number
          id: string
          message: string | null
          period_month: string
          pulled_at: string
          pulled_by: string | null
          status: string
        }
        Insert: {
          client_id: string
          docs_found?: number
          id?: string
          message?: string | null
          period_month: string
          pulled_at?: string
          pulled_by?: string | null
          status: string
        }
        Update: {
          client_id?: string
          docs_found?: number
          id?: string
          message?: string | null
          period_month?: string
          pulled_at?: string
          pulled_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "einvoice_pulls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      einvoice_threshold_alerts: {
        Row: {
          client_id: string
          dismissed_at: string | null
          email_outbox_id: string | null
          financial_year: string
          id: string
          level: string
          notified_at: string
          turnover: number
        }
        Insert: {
          client_id: string
          dismissed_at?: string | null
          email_outbox_id?: string | null
          financial_year: string
          id?: string
          level: string
          notified_at?: string
          turnover: number
        }
        Update: {
          client_id?: string
          dismissed_at?: string | null
          email_outbox_id?: string | null
          financial_year?: string
          id?: string
          level?: string
          notified_at?: string
          turnover?: number
        }
        Relationships: [
          {
            foreignKeyName: "einvoice_threshold_alerts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr1_direct_filing_approvals: {
        Row: {
          client_id: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          period_month: string
          reason: string
          requested_at: string
          requested_by: string | null
          return_type: string
          status: string
        }
        Insert: {
          client_id: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          period_month: string
          reason: string
          requested_at?: string
          requested_by?: string | null
          return_type: string
          status?: string
        }
        Update: {
          client_id?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          period_month?: string
          reason?: string
          requested_at?: string
          requested_by?: string | null
          return_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "gstr1_direct_filing_approvals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_audit_log: {
        Row: {
          agent_id: string | null
          at: string
          client_id: string | null
          cost_usd: number | null
          document_sha256: string | null
          duration_ms: number | null
          error: string | null
          extraction_id: string | null
          id: number
          input_tokens: number | null
          model: string | null
          notice_id: string | null
          output_tokens: number | null
          purpose: string
          request_id: string | null
          requested_by_name: string | null
          status: string
        }
        Insert: {
          agent_id?: string | null
          at?: string
          client_id?: string | null
          cost_usd?: number | null
          document_sha256?: string | null
          duration_ms?: number | null
          error?: string | null
          extraction_id?: string | null
          id?: number
          input_tokens?: number | null
          model?: string | null
          notice_id?: string | null
          output_tokens?: number | null
          purpose: string
          request_id?: string | null
          requested_by_name?: string | null
          status: string
        }
        Update: {
          agent_id?: string | null
          at?: string
          client_id?: string | null
          cost_usd?: number | null
          document_sha256?: string | null
          duration_ms?: number | null
          error?: string | null
          extraction_id?: string | null
          id?: number
          input_tokens?: number | null
          model?: string | null
          notice_id?: string | null
          output_tokens?: number | null
          purpose?: string
          request_id?: string | null
          requested_by_name?: string | null
          status?: string
        }
        Relationships: [
        ]
      }
      ai_assist_runs: {
        Row: {
          answer: string | null
          client_id: string
          cost_usd: number | null
          created_at: string
          error: string | null
          examples: Json | null
          examples_used: string[] | null
          feedback: string | null
          feedback_at: string | null
          feedback_by_name: string | null
          final_text: string | null
          finished_at: string | null
          id: string
          input_text: string | null
          issue_id: string | null
          mode: string
          model: string | null
          notice_id: string
          output: Json | null
          question: string | null
          reason_class: string | null
          requested_by_name: string | null
          status: string
          usage: Json | null
        }
        Insert: {
          answer?: string | null
          client_id: string
          cost_usd?: number | null
          created_at?: string
          error?: string | null
          examples?: Json | null
          examples_used?: string[] | null
          feedback?: string | null
          feedback_at?: string | null
          feedback_by_name?: string | null
          final_text?: string | null
          finished_at?: string | null
          id?: string
          input_text?: string | null
          issue_id?: string | null
          mode: string
          model?: string | null
          notice_id: string
          output?: Json | null
          question?: string | null
          reason_class?: string | null
          requested_by_name?: string | null
          status?: string
          usage?: Json | null
        }
        Update: {
          answer?: string | null
          client_id?: string
          cost_usd?: number | null
          created_at?: string
          error?: string | null
          examples?: Json | null
          examples_used?: string[] | null
          feedback?: string | null
          feedback_at?: string | null
          feedback_by_name?: string | null
          final_text?: string | null
          finished_at?: string | null
          id?: string
          input_text?: string | null
          issue_id?: string | null
          mode?: string
          model?: string | null
          notice_id?: string
          output?: Json | null
          question?: string | null
          reason_class?: string | null
          requested_by_name?: string | null
          status?: string
          usage?: Json | null
        }
        Relationships: [
        ]
      }
      ai_documents: {
        Row: {
          overview: Json | null
          agent_id: string | null
          attempts: number
          body: string | null
          case_id: string | null
          claimed_at: string | null
          client_id: string
          context: Json | null
          created_at: string
          doc_date: string | null
          doc_kind: string | null
          document_sha256: string | null
          draft_id: string | null
          error: string | null
          finished_at: string | null
          folder_item_id: string | null
          folder_section: string | null
          id: string
          key_facts: Json | null
          label: string | null
          learning_decided_at: string | null
          learning_decided_by_name: string | null
          learning_included: boolean
          model: string | null
          not_before: string | null
          notice_id: string | null
          outcome: string | null
          pages: number | null
          paragraphs: Json | null
          priority: number
          reason_class: string | null
          reference: string | null
          role: string
          sort_date: string | null
          source: string
          source_ref: string
          status: string
          summary: string | null
          text_layer: boolean | null
          title: string | null
          updated_at: string
          url: string | null
          usage: Json | null
        }
        Insert: {
          overview?: Json | null
          agent_id?: string | null
          attempts?: number
          body?: string | null
          case_id?: string | null
          claimed_at?: string | null
          client_id: string
          context?: Json | null
          created_at?: string
          doc_date?: string | null
          doc_kind?: string | null
          document_sha256?: string | null
          draft_id?: string | null
          error?: string | null
          finished_at?: string | null
          folder_item_id?: string | null
          folder_section?: string | null
          id?: string
          key_facts?: Json | null
          label?: string | null
          learning_decided_at?: string | null
          learning_decided_by_name?: string | null
          learning_included?: boolean
          model?: string | null
          not_before?: string | null
          notice_id?: string | null
          outcome?: string | null
          pages?: number | null
          paragraphs?: Json | null
          priority?: number
          reason_class?: string | null
          reference?: string | null
          role: string
          sort_date?: string | null
          source: string
          source_ref: string
          status?: string
          summary?: string | null
          text_layer?: boolean | null
          title?: string | null
          updated_at?: string
          url?: string | null
          usage?: Json | null
        }
        Update: {
          overview?: Json | null
          agent_id?: string | null
          attempts?: number
          body?: string | null
          case_id?: string | null
          claimed_at?: string | null
          client_id?: string
          context?: Json | null
          created_at?: string
          doc_date?: string | null
          doc_kind?: string | null
          document_sha256?: string | null
          draft_id?: string | null
          error?: string | null
          finished_at?: string | null
          folder_item_id?: string | null
          folder_section?: string | null
          id?: string
          key_facts?: Json | null
          label?: string | null
          learning_decided_at?: string | null
          learning_decided_by_name?: string | null
          learning_included?: boolean
          model?: string | null
          not_before?: string | null
          notice_id?: string | null
          outcome?: string | null
          pages?: number | null
          paragraphs?: Json | null
          priority?: number
          reason_class?: string | null
          reference?: string | null
          role?: string
          sort_date?: string | null
          source?: string
          source_ref?: string
          status?: string
          summary?: string | null
          text_layer?: boolean | null
          title?: string | null
          updated_at?: string
          url?: string | null
          usage?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_learning_pairs: {
        Row: {
          ai_text: string | null
          allegation: string
          case_id: string | null
          client_id: string
          created_at: string
          decided_at: string | null
          decided_by_name: string | null
          document_id: string
          financial_year: string | null
          form_code: string | null
          id: string
          included: boolean
          issue_code: string
          issue_id: string | null
          issue_title: string | null
          last_used_at: string | null
          notice_id: string | null
          origin: string
          outcome: string | null
          page: number | null
          response: string
          search: unknown | null
          section_of_law: string | null
          seq: number | null
          updated_at: string
          uses: number
          verified: boolean
        }
        Insert: {
          ai_text?: string | null
          allegation: string
          case_id?: string | null
          client_id: string
          created_at?: string
          decided_at?: string | null
          decided_by_name?: string | null
          document_id: string
          financial_year?: string | null
          form_code?: string | null
          id?: string
          included?: boolean
          issue_code?: string
          issue_id?: string | null
          issue_title?: string | null
          last_used_at?: string | null
          notice_id?: string | null
          origin: string
          outcome?: string | null
          page?: number | null
          response: string
          search?: unknown | null
          section_of_law?: string | null
          seq?: number | null
          updated_at?: string
          uses?: number
          verified?: boolean
        }
        Update: {
          ai_text?: string | null
          allegation?: string
          case_id?: string | null
          client_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by_name?: string | null
          document_id?: string
          financial_year?: string | null
          form_code?: string | null
          id?: string
          included?: boolean
          issue_code?: string
          issue_id?: string | null
          issue_title?: string | null
          last_used_at?: string | null
          notice_id?: string | null
          origin?: string
          outcome?: string | null
          page?: number | null
          response?: string
          search?: unknown | null
          section_of_law?: string | null
          seq?: number | null
          updated_at?: string
          uses?: number
          verified?: boolean
        }
        Relationships: [
        ]
      }
      ai_runner_status: {
        Row: {
          id: boolean
          key_ok: boolean | null
          last_error: string | null
          last_error_at: string | null
          last_sync_at: string | null
          last_tick_at: string | null
          last_work_at: string | null
          lease_holder: string | null
          lease_until: string | null
          version: string | null
        }
        Insert: {
          id?: boolean
          key_ok?: boolean | null
          last_error?: string | null
          last_error_at?: string | null
          last_sync_at?: string | null
          last_tick_at?: string | null
          last_work_at?: string | null
          lease_holder?: string | null
          lease_until?: string | null
          version?: string | null
        }
        Update: {
          id?: boolean
          key_ok?: boolean | null
          last_error?: string | null
          last_error_at?: string | null
          last_sync_at?: string | null
          last_tick_at?: string | null
          last_work_at?: string | null
          lease_holder?: string | null
          lease_until?: string | null
          version?: string | null
        }
        Relationships: [
        ]
      }
      ai_settings: {
        Row: {
          runner: string
          consent_scope: string
          read_backfill: boolean
          read_documents: boolean
          doc_effort: string
          doc_max_pages: number
          assist_effort: string
          assist_daily_cap_usd: number
          learning_auto_include: boolean
          edge_seconds: number
          auto_read_new: boolean
          daily_cap_usd: number
          effort: string
          id: boolean
          max_pages: number
          model: string
          price_in_per_mtok: number
          price_out_per_mtok: number
          read_enabled: boolean
          updated_at: string
          updated_by_name: string | null
          usd_inr: number
        }
        Insert: {
          runner?: string
          consent_scope?: string
          read_backfill?: boolean
          read_documents?: boolean
          doc_effort?: string
          doc_max_pages?: number
          assist_effort?: string
          assist_daily_cap_usd?: number
          learning_auto_include?: boolean
          edge_seconds?: number
          auto_read_new?: boolean
          daily_cap_usd?: number
          effort?: string
          id?: boolean
          max_pages?: number
          model?: string
          price_in_per_mtok?: number
          price_out_per_mtok?: number
          read_enabled?: boolean
          updated_at?: string
          updated_by_name?: string | null
          usd_inr?: number
        }
        Update: {
          runner?: string
          consent_scope?: string
          read_backfill?: boolean
          read_documents?: boolean
          doc_effort?: string
          doc_max_pages?: number
          assist_effort?: string
          assist_daily_cap_usd?: number
          learning_auto_include?: boolean
          edge_seconds?: number
          auto_read_new?: boolean
          daily_cap_usd?: number
          effort?: string
          id?: boolean
          max_pages?: number
          model?: string
          price_in_per_mtok?: number
          price_out_per_mtok?: number
          read_enabled?: boolean
          updated_at?: string
          updated_by_name?: string | null
          usd_inr?: number
        }
        Relationships: [
        ]
      }
      autopilot_presence: {
        Row: {
          last_seen: string
          name: string | null
          user_id: string
        }
        Insert: {
          last_seen?: string
          name?: string | null
          user_id: string
        }
        Update: {
          last_seen?: string
          name?: string | null
          user_id?: string
        }
        Relationships: [
        ]
      }
      autopilot_settings: {
        Row: {
          afternoon_at: string
          afternoon_scope: string
          captcha_refresh_secs: number
          captcha_wait_secs: number
          close_at: string
          concurrency: number
          email_trigger: boolean
          enabled: boolean
          id: boolean
          inbox_address: string | null
          inbox_last_error: string | null
          inbox_last_poll_at: string | null
          keep_sessions: boolean
          max_attempts: number
          morning_at: string
          nudge_at: string
          paused_until: string | null
          runner: string
          schedule_enabled: boolean
          updated_at: string
          updated_by_name: string | null
        }
        Insert: {
          afternoon_at?: string
          afternoon_scope?: string
          captcha_refresh_secs?: number
          captcha_wait_secs?: number
          close_at?: string
          concurrency?: number
          email_trigger?: boolean
          enabled?: boolean
          id?: boolean
          inbox_address?: string | null
          inbox_last_error?: string | null
          inbox_last_poll_at?: string | null
          keep_sessions?: boolean
          max_attempts?: number
          morning_at?: string
          nudge_at?: string
          paused_until?: string | null
          runner?: string
          schedule_enabled?: boolean
          updated_at?: string
          updated_by_name?: string | null
        }
        Update: {
          afternoon_at?: string
          afternoon_scope?: string
          captcha_refresh_secs?: number
          captcha_wait_secs?: number
          close_at?: string
          concurrency?: number
          email_trigger?: boolean
          enabled?: boolean
          id?: boolean
          inbox_address?: string | null
          inbox_last_error?: string | null
          inbox_last_poll_at?: string | null
          keep_sessions?: boolean
          max_attempts?: number
          morning_at?: string
          nudge_at?: string
          paused_until?: string | null
          runner?: string
          schedule_enabled?: boolean
          updated_at?: string
          updated_by_name?: string | null
        }
        Relationships: [
        ]
      }
      autopilot_slot_runs: {
        Row: {
          fired_at: string
          ist_date: string
          jobs: number
          note: string | null
          run_id: string | null
          slot: string
        }
        Insert: {
          fired_at?: string
          ist_date: string
          jobs?: number
          note?: string | null
          run_id?: string | null
          slot: string
        }
        Update: {
          fired_at?: string
          ist_date?: string
          jobs?: number
          note?: string | null
          run_id?: string | null
          slot?: string
        }
        Relationships: [
        ]
      }
      autopilot_wall_minutes: {
        Row: {
          ist_date: string
          name: string | null
          seconds: number
          user_id: string
        }
        Insert: {
          ist_date: string
          name?: string | null
          seconds?: number
          user_id: string
        }
        Update: {
          ist_date?: string
          name?: string | null
          seconds?: number
          user_id?: string
        }
        Relationships: [
        ]
      }
      gst_portal_applications: {
        Row: {
          arn: string | null
          case_id: string | null
          case_type_cd: string
          client_id: string
          deleted_at: string | null
          filed_date: string | null
          first_seen_at: string
          form_description: string | null
          form_number: string | null
          id: string
          last_seen_at: string
          portal_hash: string | null
          portal_key: string
          raw_json: Json | null
          status: string | null
        }
        Insert: {
          arn?: string | null
          case_id?: string | null
          case_type_cd: string
          client_id: string
          deleted_at?: string | null
          filed_date?: string | null
          first_seen_at?: string
          form_description?: string | null
          form_number?: string | null
          id?: string
          last_seen_at?: string
          portal_hash?: string | null
          portal_key: string
          raw_json?: Json | null
          status?: string | null
        }
        Update: {
          arn?: string | null
          case_id?: string | null
          case_type_cd?: string
          client_id?: string
          deleted_at?: string | null
          filed_date?: string | null
          first_seen_at?: string
          form_description?: string | null
          form_number?: string | null
          id?: string
          last_seen_at?: string
          portal_hash?: string | null
          portal_key?: string
          raw_json?: Json | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gst_portal_applications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_case_seen: {
        Row: { client_id: string; case_key: string; seen_at: string; seen_by_name: string | null }
        Insert: { client_id: string; case_key: string; seen_at?: string; seen_by_name?: string | null }
        Update: { client_id?: string; case_key?: string; seen_at?: string; seen_by_name?: string | null }
        Relationships: []
      }
      notice_bell_state: {
        Row: {
          user_id: string
          seen_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          seen_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          seen_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      annexure3_other_payments: {
        Row: {
          amount: number
          client_id: string
          created_at: string
          entered_by: string | null
          financial_year: string
          id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          client_id: string
          created_at?: string
          entered_by?: string | null
          financial_year: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          client_id?: string
          created_at?: string
          entered_by?: string | null
          financial_year?: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "annexure3_other_payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      annual_return_carry_forward: {
        Row: {
          cess: number
          cgst: number
          clause_ref: string | null
          client_id: string
          created_at: string
          direction: string
          entered_by: string | null
          financial_year: string
          id: string
          igst: number
          notes: string | null
          sgst: number
          taxable_value: number
          updated_at: string
        }
        Insert: {
          cess?: number
          cgst?: number
          clause_ref?: string | null
          client_id: string
          created_at?: string
          direction: string
          entered_by?: string | null
          financial_year: string
          id?: string
          igst?: number
          notes?: string | null
          sgst?: number
          taxable_value?: number
          updated_at?: string
        }
        Update: {
          cess?: number
          cgst?: number
          clause_ref?: string | null
          client_id?: string
          created_at?: string
          direction?: string
          entered_by?: string | null
          financial_year?: string
          id?: string
          igst?: number
          notes?: string | null
          sgst?: number
          taxable_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "annual_return_carry_forward_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      annual_return_change_log: {
        Row: {
          action: string | null
          changed_at: string
          changed_by: string | null
          client_id: string
          doc_key: string
          financial_year: string
          id: number
          kind: string
          new_value: Json | null
          old_value: Json | null
          path: string[]
          row_label: string | null
          version: number | null
        }
        Insert: {
          action?: string | null
          changed_at?: string
          changed_by?: string | null
          client_id: string
          doc_key: string
          financial_year: string
          id?: number
          kind: string
          new_value?: Json | null
          old_value?: Json | null
          path?: string[]
          row_label?: string | null
          version?: number | null
        }
        Update: {
          action?: string | null
          changed_at?: string
          changed_by?: string | null
          client_id?: string
          doc_key?: string
          financial_year?: string
          id?: number
          kind?: string
          new_value?: Json | null
          old_value?: Json | null
          path?: string[]
          row_label?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "annual_return_change_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      annual_return_doc_history: {
        Row: {
          archived_at: string
          client_id: string
          data: Json
          doc_id: string
          doc_key: string
          financial_year: string
          id: string
          reason: string | null
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          archived_at?: string
          client_id: string
          data: Json
          doc_id: string
          doc_key: string
          financial_year: string
          id?: string
          reason?: string | null
          updated_at: string
          updated_by?: string | null
          version: number
        }
        Update: {
          archived_at?: string
          client_id?: string
          data?: Json
          doc_id?: string
          doc_key?: string
          financial_year?: string
          id?: string
          reason?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "annual_return_doc_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      annual_return_docs: {
        Row: {
          client_id: string
          created_at: string
          data: Json
          doc_key: string
          financial_year: string
          id: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          client_id: string
          created_at?: string
          data?: Json
          doc_key: string
          financial_year: string
          id?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          client_id?: string
          created_at?: string
          data?: Json
          doc_key?: string
          financial_year?: string
          id?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "annual_return_docs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      annual_return_payable_setoffs: {
        Row: {
          cess: number
          cgst: number
          client_id: string
          created_at: string
          created_by: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          doc_date: string | null
          drc03_id: string | null
          evidence_name: string | null
          evidence_url: string | null
          financial_year: string
          gstr3b_period: string | null
          gstr3b_table: string | null
          id: string
          igst: number
          method: string
          note: string | null
          reference: string | null
          sgst: number
          side: string
        }
        Insert: {
          cess?: number
          cgst?: number
          client_id: string
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          doc_date?: string | null
          drc03_id?: string | null
          evidence_name?: string | null
          evidence_url?: string | null
          financial_year: string
          gstr3b_period?: string | null
          gstr3b_table?: string | null
          id?: string
          igst?: number
          method: string
          note?: string | null
          reference?: string | null
          sgst?: number
          side: string
        }
        Update: {
          cess?: number
          cgst?: number
          client_id?: string
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          doc_date?: string | null
          drc03_id?: string | null
          evidence_name?: string | null
          evidence_url?: string | null
          financial_year?: string
          gstr3b_period?: string | null
          gstr3b_table?: string | null
          id?: string
          igst?: number
          method?: string
          note?: string | null
          reference?: string | null
          sgst?: number
          side?: string
        }
        Relationships: [
          {
            foreignKeyName: "annual_return_payable_setoffs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_return_payable_setoffs_drc03_id_fkey"
            columns: ["drc03_id"]
            isOneToOne: false
            referencedRelation: "gst_drc03_filings"
            referencedColumns: ["id"]
          },
        ]
      }
      annual_return_periods: {
        Row: {
          allotted_at: string | null
          allotted_by_name: string | null
          changes_at_lock: number | null
          changes_at_verify: number | null
          preparer_allotted_at: string | null
          preparer_id: string | null
          preparer_name: string | null
          returned_at: string | null
          returned_by_name: string | null
          returned_note: string | null
          returned_to: string | null
          reviewer_id: string | null
          reviewer_name: string | null
          signoff_overrides: Json
          signoff_rev: number
          verified_at: string | null
          verified_by: string | null
          verified_by_name: string | null
          verified_note: string | null
          verified_role: string | null
          verifier_id: string | null
          verifier_name: string | null
          client_id: string
          created_at: string
          financial_year: string
          id: string
          locked_at: string | null
          locked_by: string | null
          notes: string | null
          payables_at_lock: Json | null
          prepared_at: string | null
          prepared_by_name: string | null
          prepared_note: string | null
          review_checklist: Json | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by_name: string | null
          reviewed_role: string | null
          prepared_by: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          allotted_at?: string | null
          allotted_by_name?: string | null
          changes_at_lock?: number | null
          changes_at_verify?: number | null
          preparer_allotted_at?: string | null
          preparer_id?: string | null
          preparer_name?: string | null
          returned_at?: string | null
          returned_by_name?: string | null
          returned_note?: string | null
          returned_to?: string | null
          reviewer_id?: string | null
          reviewer_name?: string | null
          signoff_overrides?: Json
          signoff_rev?: number
          verified_at?: string | null
          verified_by?: string | null
          verified_by_name?: string | null
          verified_note?: string | null
          verified_role?: string | null
          verifier_id?: string | null
          verifier_name?: string | null
          client_id: string
          created_at?: string
          financial_year: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          notes?: string | null
          payables_at_lock?: Json | null
          prepared_at?: string | null
          prepared_by_name?: string | null
          prepared_note?: string | null
          review_checklist?: Json | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_name?: string | null
          reviewed_role?: string | null
          prepared_by?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          allotted_at?: string | null
          allotted_by_name?: string | null
          changes_at_lock?: number | null
          changes_at_verify?: number | null
          preparer_allotted_at?: string | null
          preparer_id?: string | null
          preparer_name?: string | null
          returned_at?: string | null
          returned_by_name?: string | null
          returned_note?: string | null
          returned_to?: string | null
          reviewer_id?: string | null
          reviewer_name?: string | null
          signoff_overrides?: Json
          signoff_rev?: number
          verified_at?: string | null
          verified_by?: string | null
          verified_by_name?: string | null
          verified_note?: string | null
          verified_role?: string | null
          verifier_id?: string | null
          verifier_name?: string | null
          client_id?: string
          created_at?: string
          financial_year?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          notes?: string | null
          payables_at_lock?: Json | null
          prepared_at?: string | null
          prepared_by_name?: string | null
          prepared_note?: string | null
          review_checklist?: Json | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_name?: string | null
          reviewed_role?: string | null
          prepared_by?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "annual_return_periods_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          client_id: string | null
          client_name: string | null
          created_at: string
          details: Json | null
          financial_year: string | null
          id: string
          module: string
          records_deleted: number | null
          user_id: string
          user_role: string
        }
        Insert: {
          action?: string
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          details?: Json | null
          financial_year?: string | null
          id?: string
          module: string
          records_deleted?: number | null
          user_id: string
          user_role: string
        }
        Update: {
          action?: string
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          details?: Json | null
          financial_year?: string | null
          id?: string
          module?: string
          records_deleted?: number | null
          user_id?: string
          user_role?: string
        }
        Relationships: []
      }
      bills_not_in_2b: {
        Row: {
          client_id: string
          date: string
          id: string
          input_cgst: number | null
          input_igst: number | null
          input_sgst: number | null
          is_carried_forward: boolean | null
          is_locked: boolean | null
          period_month: string
          reclaim_month: string | null
          reclaim_subtype: string | null
          reclaimed_via_doc_id: string | null
          reversal_month: string | null
          source_book_id: string | null
          supplier_gstin: string | null
          supplier_invoice_number: string | null
          supplier_name: string
          taxable_value: number | null
          updated_at: string | null
          updated_by: string | null
          version: number | null
        }
        Insert: {
          client_id: string
          date: string
          id?: string
          input_cgst?: number | null
          input_igst?: number | null
          input_sgst?: number | null
          is_carried_forward?: boolean | null
          is_locked?: boolean | null
          period_month: string
          reclaim_month?: string | null
          reclaim_subtype?: string | null
          reclaimed_via_doc_id?: string | null
          reversal_month?: string | null
          source_book_id?: string | null
          supplier_gstin?: string | null
          supplier_invoice_number?: string | null
          supplier_name: string
          taxable_value?: number | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
        }
        Update: {
          client_id?: string
          date?: string
          id?: string
          input_cgst?: number | null
          input_igst?: number | null
          input_sgst?: number | null
          is_carried_forward?: boolean | null
          is_locked?: boolean | null
          period_month?: string
          reclaim_month?: string | null
          reclaim_subtype?: string | null
          reclaimed_via_doc_id?: string | null
          reversal_month?: string | null
          source_book_id?: string | null
          supplier_gstin?: string | null
          supplier_invoice_number?: string | null
          supplier_name?: string
          taxable_value?: number | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bills_not_in_2b_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_not_in_2b_reclaimed_via_doc_id_fkey"
            columns: ["reclaimed_via_doc_id"]
            isOneToOne: false
            referencedRelation: "twob_import_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_not_in_2b_source_book_id_fkey"
            columns: ["source_book_id"]
            isOneToOne: false
            referencedRelation: "books_register"
            referencedColumns: ["id"]
          },
        ]
      }
      bills_not_in_books: {
        Row: {
          bill_in_2b_month: string | null
          book_entry_month: string | null
          client_id: string
          date: string
          id: string
          input_cgst: number | null
          input_igst: number | null
          input_sgst: number | null
          is_carried_forward: boolean | null
          is_locked: boolean | null
          period_month: string
          source_doc_id: string | null
          supplier_gstin: string | null
          supplier_invoice_number: string | null
          supplier_name: string
          taxable_value: number | null
          updated_at: string | null
          updated_by: string | null
          version: number | null
        }
        Insert: {
          bill_in_2b_month?: string | null
          book_entry_month?: string | null
          client_id: string
          date: string
          id?: string
          input_cgst?: number | null
          input_igst?: number | null
          input_sgst?: number | null
          is_carried_forward?: boolean | null
          is_locked?: boolean | null
          period_month: string
          source_doc_id?: string | null
          supplier_gstin?: string | null
          supplier_invoice_number?: string | null
          supplier_name: string
          taxable_value?: number | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
        }
        Update: {
          bill_in_2b_month?: string | null
          book_entry_month?: string | null
          client_id?: string
          date?: string
          id?: string
          input_cgst?: number | null
          input_igst?: number | null
          input_sgst?: number | null
          is_carried_forward?: boolean | null
          is_locked?: boolean | null
          period_month?: string
          source_doc_id?: string | null
          supplier_gstin?: string | null
          supplier_invoice_number?: string | null
          supplier_name?: string
          taxable_value?: number | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bills_not_in_books_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_not_in_books_source_doc_id_fkey"
            columns: ["source_doc_id"]
            isOneToOne: false
            referencedRelation: "twob_import_docs"
            referencedColumns: ["id"]
          },
        ]
      }
      books_purchase_lines: {
        Row: {
          cgst: number
          client_id: string
          created_at: string
          entered_by: string | null
          expense_head: string | null
          financial_year: string
          id: string
          igst: number
          ledger_head: string
          notes: string | null
          rate: string | null
          sgst: number
          taxable_value: number
          updated_at: string
        }
        Insert: {
          cgst?: number
          client_id: string
          created_at?: string
          entered_by?: string | null
          expense_head?: string | null
          financial_year: string
          id?: string
          igst?: number
          ledger_head: string
          notes?: string | null
          rate?: string | null
          sgst?: number
          taxable_value?: number
          updated_at?: string
        }
        Update: {
          cgst?: number
          client_id?: string
          created_at?: string
          entered_by?: string | null
          expense_head?: string | null
          financial_year?: string
          id?: string
          igst?: number
          ledger_head?: string
          notes?: string | null
          rate?: string | null
          sgst?: number
          taxable_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "books_purchase_lines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      books_register: {
        Row: {
          book_treatment: string
          client_id: string
          created_at: string | null
          date: string | null
          id: string
          input_cgst: number | null
          input_igst: number | null
          input_sgst: number | null
          matched_2b_id: string | null
          period_month: string
          posted_at: string | null
          posted_by: string | null
          supplier_gstin: string | null
          supplier_invoice_number: string | null
          supplier_name: string | null
          taxable_value: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          book_treatment?: string
          client_id: string
          created_at?: string | null
          date?: string | null
          id?: string
          input_cgst?: number | null
          input_igst?: number | null
          input_sgst?: number | null
          matched_2b_id?: string | null
          period_month: string
          posted_at?: string | null
          posted_by?: string | null
          supplier_gstin?: string | null
          supplier_invoice_number?: string | null
          supplier_name?: string | null
          taxable_value?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          book_treatment?: string
          client_id?: string
          created_at?: string | null
          date?: string | null
          id?: string
          input_cgst?: number | null
          input_igst?: number | null
          input_sgst?: number | null
          matched_2b_id?: string | null
          period_month?: string
          posted_at?: string | null
          posted_by?: string | null
          supplier_gstin?: string | null
          supplier_invoice_number?: string | null
          supplier_name?: string | null
          taxable_value?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "books_register_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      books_turnover_lines: {
        Row: {
          cgst: number
          client_id: string
          created_at: string
          entered_by: string | null
          financial_year: string
          id: string
          igst: number
          ledger_head: string
          notes: string | null
          rate: string | null
          sgst: number
          taxable_value: number
          updated_at: string
        }
        Insert: {
          cgst?: number
          client_id: string
          created_at?: string
          entered_by?: string | null
          financial_year: string
          id?: string
          igst?: number
          ledger_head: string
          notes?: string | null
          rate?: string | null
          sgst?: number
          taxable_value?: number
          updated_at?: string
        }
        Update: {
          cgst?: number
          client_id?: string
          created_at?: string
          entered_by?: string | null
          financial_year?: string
          id?: string
          igst?: number
          ledger_head?: string
          notes?: string | null
          rate?: string | null
          sgst?: number
          taxable_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "books_turnover_lines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_advance_adjustments: {
        Row: {
          cgst: number
          consideration_adjusted: number
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string
          period_month: string
          rate_code: string
          rate_pct: number
          receipt_id: string
          sgst: number
          taxable_value_adjusted: number
        }
        Insert: {
          cgst?: number
          consideration_adjusted?: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id: string
          period_month: string
          rate_code: string
          rate_pct?: number
          receipt_id: string
          sgst?: number
          taxable_value_adjusted?: number
        }
        Update: {
          cgst?: number
          consideration_adjusted?: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string
          period_month?: string
          rate_code?: string
          rate_pct?: number
          receipt_id?: string
          sgst?: number
          taxable_value_adjusted?: number
        }
        Relationships: [
          {
            foreignKeyName: "builder_advance_adjustments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "builder_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_advance_adjustments_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "builder_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_booking_members: {
        Row: {
          booking_id: string
          created_at: string
          email: string | null
          id: string
          is_primary: boolean
          name: string
          ownership_ratio: number
          pan: string | null
          phone: string | null
          sort_order: number
        }
        Insert: {
          booking_id: string
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          name: string
          ownership_ratio?: number
          pan?: string | null
          phone?: string | null
          sort_order?: number
        }
        Update: {
          booking_id?: string
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          name?: string
          ownership_ratio?: number
          pan?: string | null
          phone?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "builder_booking_members_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "builder_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_bookings: {
        Row: {
          booking_date: string
          cancellation_reason: string | null
          cancelled_on: string | null
          converted_to_booking_id: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          status: string
          total_consideration: number
          unit_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          booking_date: string
          cancellation_reason?: string | null
          cancelled_on?: string | null
          converted_to_booking_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          status?: string
          total_consideration?: number
          unit_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          booking_date?: string
          cancellation_reason?: string | null
          cancelled_on?: string | null
          converted_to_booking_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          status?: string
          total_consideration?: number
          unit_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_bookings_converted_to_booking_id_fkey"
            columns: ["converted_to_booking_id"]
            isOneToOne: false
            referencedRelation: "builder_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_bookings_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_bookings_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_bookings_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_bounce_offsets: {
        Row: {
          cgst: number
          consideration: number
          created_at: string
          created_by: string | null
          id: string
          period_month: string
          reversal_id: string
          sgst: number
          taxable_value: number
        }
        Insert: {
          cgst?: number
          consideration?: number
          created_at?: string
          created_by?: string | null
          id?: string
          period_month: string
          reversal_id: string
          sgst?: number
          taxable_value?: number
        }
        Update: {
          cgst?: number
          consideration?: number
          created_at?: string
          created_by?: string | null
          id?: string
          period_month?: string
          reversal_id?: string
          sgst?: number
          taxable_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "builder_bounce_offsets_reversal_id_fkey"
            columns: ["reversal_id"]
            isOneToOne: false
            referencedRelation: "builder_bounce_reversals"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_bounce_reversals: {
        Row: {
          adjusted_value: number
          bounced_on: string
          cgst: number
          consideration: number
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          original_period: string
          project_id: string
          rate_code: string
          rate_pct: number
          receipt_id: string
          sgst: number
          status: string
          taxable_value: number
          unit_id: string
          updated_at: string
        }
        Insert: {
          adjusted_value?: number
          bounced_on: string
          cgst?: number
          consideration?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          original_period: string
          project_id: string
          rate_code: string
          rate_pct?: number
          receipt_id: string
          sgst?: number
          status?: string
          taxable_value?: number
          unit_id: string
          updated_at?: string
        }
        Update: {
          adjusted_value?: number
          bounced_on?: string
          cgst?: number
          consideration?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          original_period?: string
          project_id?: string
          rate_code?: string
          rate_pct?: number
          receipt_id?: string
          sgst?: number
          status?: string
          taxable_value?: number
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_bounce_reversals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_project_areas"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "builder_bounce_reversals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_bounce_reversals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_rcm_postings"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "builder_bounce_reversals_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "builder_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_bounce_reversals_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_bounce_reversals_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_bounce_reversals_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_bu_agreement_confirmations: {
        Row: {
          agreement_value_at_request: number
          bu_event_id: string
          client_id: string
          created_at: string
          created_by: string | null
          dispute_notes: string | null
          id: string
          outbox_id: string | null
          responded_at: string | null
          response_ip: string | null
          sent_at: string | null
          status: string
          token: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          agreement_value_at_request?: number
          bu_event_id: string
          client_id: string
          created_at?: string
          created_by?: string | null
          dispute_notes?: string | null
          id?: string
          outbox_id?: string | null
          responded_at?: string | null
          response_ip?: string | null
          sent_at?: string | null
          status?: string
          token?: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          agreement_value_at_request?: number
          bu_event_id?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          dispute_notes?: string | null
          id?: string
          outbox_id?: string | null
          responded_at?: string | null
          response_ip?: string | null
          sent_at?: string | null
          status?: string
          token?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_bu_agreement_confirmations_bu_event_id_fkey"
            columns: ["bu_event_id"]
            isOneToOne: false
            referencedRelation: "builder_bu_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_bu_agreement_confirmations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_bu_agreement_confirmations_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "email_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_bu_agreement_confirmations_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_bu_agreement_confirmations_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_bu_agreement_confirmations_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_bu_event_units: {
        Row: {
          agreement_value: number
          booked_at_cutoff: boolean
          booking_id: string | null
          bu_event_id: string
          carpet_area_sqm: number
          created_at: string
          cut_off_date: string
          cut_off_source: string
          differential_cgst: number
          differential_sgst: number
          differential_taxable_value: number
          differential_value: number
          id: string
          interest_amount: number
          interest_days: number
          invoice_id: string | null
          invoiced_before: number
          notes: string | null
          open_advance_before: number
          rate_code: string
          rate_pct: number
          received_upto_cutoff: number
          subsumed_receipt_count: number
          tie_out_diff: number
          unit_id: string
          unit_type: string
          value_taxed_upto_opening: number
        }
        Insert: {
          agreement_value?: number
          booked_at_cutoff?: boolean
          booking_id?: string | null
          bu_event_id: string
          carpet_area_sqm?: number
          created_at?: string
          cut_off_date: string
          cut_off_source?: string
          differential_cgst?: number
          differential_sgst?: number
          differential_taxable_value?: number
          differential_value?: number
          id?: string
          interest_amount?: number
          interest_days?: number
          invoice_id?: string | null
          invoiced_before?: number
          notes?: string | null
          open_advance_before?: number
          rate_code: string
          rate_pct?: number
          received_upto_cutoff?: number
          subsumed_receipt_count?: number
          tie_out_diff?: number
          unit_id: string
          unit_type: string
          value_taxed_upto_opening?: number
        }
        Update: {
          agreement_value?: number
          booked_at_cutoff?: boolean
          booking_id?: string | null
          bu_event_id?: string
          carpet_area_sqm?: number
          created_at?: string
          cut_off_date?: string
          cut_off_source?: string
          differential_cgst?: number
          differential_sgst?: number
          differential_taxable_value?: number
          differential_value?: number
          id?: string
          interest_amount?: number
          interest_days?: number
          invoice_id?: string | null
          invoiced_before?: number
          notes?: string | null
          open_advance_before?: number
          rate_code?: string
          rate_pct?: number
          received_upto_cutoff?: number
          subsumed_receipt_count?: number
          tie_out_diff?: number
          unit_id?: string
          unit_type?: string
          value_taxed_upto_opening?: number
        }
        Relationships: [
          {
            foreignKeyName: "builder_bu_event_units_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "builder_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_bu_event_units_bu_event_id_fkey"
            columns: ["bu_event_id"]
            isOneToOne: false
            referencedRelation: "builder_bu_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_bu_event_units_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "builder_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_bu_event_units_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: true
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_bu_event_units_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: true
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_bu_event_units_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: true
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_bu_events: {
        Row: {
          bu_date: string
          bu_ref_no: string | null
          created_at: string
          created_by: string | null
          discovered_on: string | null
          id: string
          notes: string | null
          posted_at: string | null
          posted_by: string | null
          posting_basis: string
          posting_period: string
          project_id: string
          scope: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bu_date: string
          bu_ref_no?: string | null
          created_at?: string
          created_by?: string | null
          discovered_on?: string | null
          id?: string
          notes?: string | null
          posted_at?: string | null
          posted_by?: string | null
          posting_basis?: string
          posting_period: string
          project_id: string
          scope?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bu_date?: string
          bu_ref_no?: string | null
          created_at?: string
          created_by?: string | null
          discovered_on?: string | null
          id?: string
          notes?: string | null
          posted_at?: string | null
          posted_by?: string | null
          posting_basis?: string
          posting_period?: string
          project_id?: string
          scope?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_bu_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_project_areas"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "builder_bu_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_bu_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_rcm_postings"
            referencedColumns: ["project_id"]
          },
        ]
      }
      builder_cancellations: {
        Row: {
          booking_id: string
          cancellation_charge_invoice_id: string | null
          cancellation_charge_taxable: number
          cancellation_date: string
          correction_method: string
          created_at: string
          created_by: string | null
          credit_note_id: string | null
          forfeiture_amount: number
          id: string
          project_id: string
          rate_code: string
          rate_pct: number
          reason: string | null
          refund_paid: number
          refund_payable: number
          status: string
          total_received: number
          unit_id: string
        }
        Insert: {
          booking_id: string
          cancellation_charge_invoice_id?: string | null
          cancellation_charge_taxable?: number
          cancellation_date: string
          correction_method: string
          created_at?: string
          created_by?: string | null
          credit_note_id?: string | null
          forfeiture_amount?: number
          id?: string
          project_id: string
          rate_code: string
          rate_pct: number
          reason?: string | null
          refund_paid?: number
          refund_payable?: number
          status?: string
          total_received?: number
          unit_id: string
        }
        Update: {
          booking_id?: string
          cancellation_charge_invoice_id?: string | null
          cancellation_charge_taxable?: number
          cancellation_date?: string
          correction_method?: string
          created_at?: string
          created_by?: string | null
          credit_note_id?: string | null
          forfeiture_amount?: number
          id?: string
          project_id?: string
          rate_code?: string
          rate_pct?: number
          reason?: string | null
          refund_paid?: number
          refund_payable?: number
          status?: string
          total_received?: number
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_cancellations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "builder_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_cancellations_cancellation_charge_invoice_id_fkey"
            columns: ["cancellation_charge_invoice_id"]
            isOneToOne: false
            referencedRelation: "builder_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_cancellations_credit_note_id_fkey"
            columns: ["credit_note_id"]
            isOneToOne: false
            referencedRelation: "builder_credit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_cancellations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_project_areas"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "builder_cancellations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_cancellations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_rcm_postings"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "builder_cancellations_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_cancellations_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_cancellations_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_client_settings: {
        Row: {
          client_id: string
          confirmation_document_url: string | null
          confirmation_notes: string | null
          confirmation_outbox_id: string | null
          confirmation_received_at: string | null
          confirmation_sent_at: string | null
          created_at: string
          default_fsi_treatment: string
          default_is_metro: boolean
          delay_interest_basis: string
          excess_tax_treatment: string
          extra_work_rate: string
          incl_club: boolean
          incl_development: boolean
          incl_legal: boolean
          incl_maintenance_corpus: boolean
          incl_other: boolean
          incl_parking: boolean
          incl_plc: boolean
          incl_utility_deposit: boolean
          raises_invoices: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          confirmation_document_url?: string | null
          confirmation_notes?: string | null
          confirmation_outbox_id?: string | null
          confirmation_received_at?: string | null
          confirmation_sent_at?: string | null
          created_at?: string
          default_fsi_treatment?: string
          default_is_metro?: boolean
          delay_interest_basis?: string
          excess_tax_treatment?: string
          extra_work_rate?: string
          incl_club?: boolean
          incl_development?: boolean
          incl_legal?: boolean
          incl_maintenance_corpus?: boolean
          incl_other?: boolean
          incl_parking?: boolean
          incl_plc?: boolean
          incl_utility_deposit?: boolean
          raises_invoices?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          confirmation_document_url?: string | null
          confirmation_notes?: string | null
          confirmation_outbox_id?: string | null
          confirmation_received_at?: string | null
          confirmation_sent_at?: string | null
          created_at?: string
          default_fsi_treatment?: string
          default_is_metro?: boolean
          delay_interest_basis?: string
          excess_tax_treatment?: string
          extra_work_rate?: string
          incl_club?: boolean
          incl_development?: boolean
          incl_legal?: boolean
          incl_maintenance_corpus?: boolean
          incl_other?: boolean
          incl_parking?: boolean
          incl_plc?: boolean
          incl_utility_deposit?: boolean
          raises_invoices?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_client_settings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_client_settings_confirmation_outbox_id_fkey"
            columns: ["confirmation_outbox_id"]
            isOneToOne: false
            referencedRelation: "email_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_conversions: {
        Row: {
          carried_value: number
          conversion_date: string
          created_at: string
          created_by: string | null
          credit_note_id: string | null
          differential_tax: number
          from_booking_id: string | null
          from_rate_code: string
          from_rate_pct: number
          from_unit_id: string
          id: string
          invoice_id: string | null
          notes: string | null
          period_month: string
          status: string
          to_booking_id: string | null
          to_rate_code: string
          to_rate_pct: number
          to_unit_id: string
        }
        Insert: {
          carried_value?: number
          conversion_date: string
          created_at?: string
          created_by?: string | null
          credit_note_id?: string | null
          differential_tax?: number
          from_booking_id?: string | null
          from_rate_code: string
          from_rate_pct?: number
          from_unit_id: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          period_month: string
          status?: string
          to_booking_id?: string | null
          to_rate_code: string
          to_rate_pct?: number
          to_unit_id: string
        }
        Update: {
          carried_value?: number
          conversion_date?: string
          created_at?: string
          created_by?: string | null
          credit_note_id?: string | null
          differential_tax?: number
          from_booking_id?: string | null
          from_rate_code?: string
          from_rate_pct?: number
          from_unit_id?: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          period_month?: string
          status?: string
          to_booking_id?: string | null
          to_rate_code?: string
          to_rate_pct?: number
          to_unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_conversions_credit_note_id_fkey"
            columns: ["credit_note_id"]
            isOneToOne: false
            referencedRelation: "builder_credit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_conversions_from_booking_id_fkey"
            columns: ["from_booking_id"]
            isOneToOne: false
            referencedRelation: "builder_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_conversions_from_unit_id_fkey"
            columns: ["from_unit_id"]
            isOneToOne: false
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_conversions_from_unit_id_fkey"
            columns: ["from_unit_id"]
            isOneToOne: false
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_conversions_from_unit_id_fkey"
            columns: ["from_unit_id"]
            isOneToOne: false
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_conversions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "builder_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_conversions_to_booking_id_fkey"
            columns: ["to_booking_id"]
            isOneToOne: false
            referencedRelation: "builder_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_conversions_to_unit_id_fkey"
            columns: ["to_unit_id"]
            isOneToOne: false
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_conversions_to_unit_id_fkey"
            columns: ["to_unit_id"]
            isOneToOne: false
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_conversions_to_unit_id_fkey"
            columns: ["to_unit_id"]
            isOneToOne: false
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_credit_notes: {
        Row: {
          booking_id: string | null
          cgst: number
          consideration: number
          created_at: string
          created_by: string | null
          doc_no: string | null
          doc_series: string | null
          id: string
          note_date: string
          note_type: string
          original_documents: Json
          period_month: string
          rate_code: string
          rate_pct: number
          reason: string | null
          sgst: number
          taxable_value: number
          unit_id: string
          window_expiry: string | null
          within_window: boolean
        }
        Insert: {
          booking_id?: string | null
          cgst?: number
          consideration?: number
          created_at?: string
          created_by?: string | null
          doc_no?: string | null
          doc_series?: string | null
          id?: string
          note_date: string
          note_type?: string
          original_documents?: Json
          period_month: string
          rate_code: string
          rate_pct?: number
          reason?: string | null
          sgst?: number
          taxable_value?: number
          unit_id: string
          window_expiry?: string | null
          within_window?: boolean
        }
        Update: {
          booking_id?: string | null
          cgst?: number
          consideration?: number
          created_at?: string
          created_by?: string | null
          doc_no?: string | null
          doc_series?: string | null
          id?: string
          note_date?: string
          note_type?: string
          original_documents?: Json
          period_month?: string
          rate_code?: string
          rate_pct?: number
          reason?: string | null
          sgst?: number
          taxable_value?: number
          unit_id?: string
          window_expiry?: string | null
          within_window?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "builder_credit_notes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "builder_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_credit_notes_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_credit_notes_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_credit_notes_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_dastavej_late_interest: {
        Row: {
          arn: string | null
          created_at: string
          created_by: string | null
          cut_off_period: string
          dastavej_date: string
          id: string
          paid_date: string | null
          project_id: string
          rate_code: string
          residual_unrecovered: number
          shortfall_value: number
          status: string
          total_allocated: number
          total_interest: number
          tranches: Json
          unit_id: string
        }
        Insert: {
          arn?: string | null
          created_at?: string
          created_by?: string | null
          cut_off_period: string
          dastavej_date: string
          id?: string
          paid_date?: string | null
          project_id: string
          rate_code: string
          residual_unrecovered?: number
          shortfall_value?: number
          status?: string
          total_allocated?: number
          total_interest?: number
          tranches?: Json
          unit_id: string
        }
        Update: {
          arn?: string | null
          created_at?: string
          created_by?: string | null
          cut_off_period?: string
          dastavej_date?: string
          id?: string
          paid_date?: string | null
          project_id?: string
          rate_code?: string
          residual_unrecovered?: number
          shortfall_value?: number
          status?: string
          total_allocated?: number
          total_interest?: number
          tranches?: Json
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_dastavej_late_interest_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_project_areas"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "builder_dastavej_late_interest_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_dastavej_late_interest_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_rcm_postings"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "builder_dastavej_late_interest_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_dastavej_late_interest_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_dastavej_late_interest_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_excess_tax: {
        Row: {
          adjusted_value: number
          created_at: string
          created_by: string | null
          excess_tax: number
          id: string
          identified_on: string
          notes: string | null
          original_consideration: number
          original_tax: number
          project_id: string
          receipt_id: string
          restated_consideration: number
          restated_tax: number
          status: string
          treatment: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          adjusted_value?: number
          created_at?: string
          created_by?: string | null
          excess_tax?: number
          id?: string
          identified_on?: string
          notes?: string | null
          original_consideration?: number
          original_tax?: number
          project_id: string
          receipt_id: string
          restated_consideration?: number
          restated_tax?: number
          status?: string
          treatment?: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          adjusted_value?: number
          created_at?: string
          created_by?: string | null
          excess_tax?: number
          id?: string
          identified_on?: string
          notes?: string | null
          original_consideration?: number
          original_tax?: number
          project_id?: string
          receipt_id?: string
          restated_consideration?: number
          restated_tax?: number
          status?: string
          treatment?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_excess_tax_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_project_areas"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "builder_excess_tax_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_excess_tax_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_rcm_postings"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "builder_excess_tax_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "builder_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_excess_tax_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_excess_tax_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_excess_tax_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_fsi_consents: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          client_id: string
          confirmation_document_url: string | null
          confirmation_received_at: string | null
          created_at: string
          created_by: string | null
          email_sent_at: string | null
          fsi_value_at_request: number
          fsi_working_id: string
          id: string
          notes: string | null
          outbox_id: string | null
          period_month: string
          project_id: string
          rcm_at_request: number
          received_by: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          client_id: string
          confirmation_document_url?: string | null
          confirmation_received_at?: string | null
          created_at?: string
          created_by?: string | null
          email_sent_at?: string | null
          fsi_value_at_request?: number
          fsi_working_id: string
          id?: string
          notes?: string | null
          outbox_id?: string | null
          period_month: string
          project_id: string
          rcm_at_request?: number
          received_by?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string
          confirmation_document_url?: string | null
          confirmation_received_at?: string | null
          created_at?: string
          created_by?: string | null
          email_sent_at?: string | null
          fsi_value_at_request?: number
          fsi_working_id?: string
          id?: string
          notes?: string | null
          outbox_id?: string | null
          period_month?: string
          project_id?: string
          rcm_at_request?: number
          received_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_fsi_consents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_fsi_consents_fsi_working_id_fkey"
            columns: ["fsi_working_id"]
            isOneToOne: true
            referencedRelation: "builder_fsi_workings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_fsi_consents_fsi_working_id_fkey"
            columns: ["fsi_working_id"]
            isOneToOne: true
            referencedRelation: "builder_rcm_postings"
            referencedColumns: ["source_id"]
          },
          {
            foreignKeyName: "builder_fsi_consents_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "email_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_fsi_consents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_project_areas"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "builder_fsi_consents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_fsi_consents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_rcm_postings"
            referencedColumns: ["project_id"]
          },
        ]
      }
      builder_fsi_workings: {
        Row: {
          allocated_value: number
          bu_event_id: string
          cap_amount: number
          cap_applied: boolean
          cgst: number
          commercial_carpet_sqm: number
          commercial_portion: number
          commercial_rcm: number
          created_at: string
          created_by: string | null
          event_carpet_sqm: number
          id: string
          notes: string | null
          period_month: string
          posted_at: string | null
          posted_by: string | null
          project_carpet_sqm: number
          project_id: string
          residential_carpet_sqm: number
          residential_portion: number
          residential_rcm: number
          residential_rcm_uncapped: number
          sgst: number
          status: string
          tdr_fsi_total_value: number
          total_rcm: number
          treatment: string
          unbooked_residential_carpet_sqm: number
          unbooked_residential_value: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allocated_value?: number
          bu_event_id: string
          cap_amount?: number
          cap_applied?: boolean
          cgst?: number
          commercial_carpet_sqm?: number
          commercial_portion?: number
          commercial_rcm?: number
          created_at?: string
          created_by?: string | null
          event_carpet_sqm?: number
          id?: string
          notes?: string | null
          period_month: string
          posted_at?: string | null
          posted_by?: string | null
          project_carpet_sqm?: number
          project_id: string
          residential_carpet_sqm?: number
          residential_portion?: number
          residential_rcm?: number
          residential_rcm_uncapped?: number
          sgst?: number
          status?: string
          tdr_fsi_total_value?: number
          total_rcm?: number
          treatment?: string
          unbooked_residential_carpet_sqm?: number
          unbooked_residential_value?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allocated_value?: number
          bu_event_id?: string
          cap_amount?: number
          cap_applied?: boolean
          cgst?: number
          commercial_carpet_sqm?: number
          commercial_portion?: number
          commercial_rcm?: number
          created_at?: string
          created_by?: string | null
          event_carpet_sqm?: number
          id?: string
          notes?: string | null
          period_month?: string
          posted_at?: string | null
          posted_by?: string | null
          project_carpet_sqm?: number
          project_id?: string
          residential_carpet_sqm?: number
          residential_portion?: number
          residential_rcm?: number
          residential_rcm_uncapped?: number
          sgst?: number
          status?: string
          tdr_fsi_total_value?: number
          total_rcm?: number
          treatment?: string
          unbooked_residential_carpet_sqm?: number
          unbooked_residential_value?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_fsi_workings_bu_event_id_fkey"
            columns: ["bu_event_id"]
            isOneToOne: true
            referencedRelation: "builder_bu_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_fsi_workings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_project_areas"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "builder_fsi_workings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_fsi_workings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_rcm_postings"
            referencedColumns: ["project_id"]
          },
        ]
      }
      builder_historical_receipts: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          receipt_date: string
          unit_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          receipt_date: string
          unit_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          receipt_date?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_historical_receipts_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_historical_receipts_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_historical_receipts_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_invoices: {
        Row: {
          booking_id: string
          cgst: number
          consideration: number
          created_at: string
          created_by: string | null
          doc_no: string | null
          doc_series: string | null
          id: string
          invoice_date: string
          invoice_type: string
          milestone_label: string | null
          notes: string | null
          period_month: string
          rate_code: string
          rate_pct: number
          sgst: number
          taxable_value: number
          unit_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          booking_id: string
          cgst?: number
          consideration?: number
          created_at?: string
          created_by?: string | null
          doc_no?: string | null
          doc_series?: string | null
          id?: string
          invoice_date: string
          invoice_type?: string
          milestone_label?: string | null
          notes?: string | null
          period_month: string
          rate_code: string
          rate_pct?: number
          sgst?: number
          taxable_value?: number
          unit_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          booking_id?: string
          cgst?: number
          consideration?: number
          created_at?: string
          created_by?: string | null
          doc_no?: string | null
          doc_series?: string | null
          id?: string
          invoice_date?: string
          invoice_type?: string
          milestone_label?: string | null
          notes?: string | null
          period_month?: string
          rate_code?: string
          rate_pct?: number
          sgst?: number
          taxable_value?: number
          unit_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_invoices_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "builder_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_invoices_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_invoices_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_invoices_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_opening_balance_adjustments: {
        Row: {
          cgst: number
          consideration_adjusted: number
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string
          period_month: string
          rate_code: string
          rate_pct: number
          sgst: number
          taxable_value_adjusted: number
          unit_id: string
        }
        Insert: {
          cgst?: number
          consideration_adjusted?: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id: string
          period_month: string
          rate_code: string
          rate_pct?: number
          sgst?: number
          taxable_value_adjusted?: number
          unit_id: string
        }
        Update: {
          cgst?: number
          consideration_adjusted?: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string
          period_month?: string
          rate_code?: string
          rate_pct?: number
          sgst?: number
          taxable_value_adjusted?: number
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_opening_balance_adjustments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "builder_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_opening_balance_adjustments_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_opening_balance_adjustments_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_opening_balance_adjustments_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_opening_balances: {
        Row: {
          agreement_value: number
          as_at_date: string
          created_at: string
          cumulative_cgst: number
          cumulative_receipts: number
          cumulative_sgst: number
          cumulative_tds_194ia: number
          cumulative_value_taxed: number
          is_affordable_at_opening: boolean | null
          notes: string | null
          rate_code_at_opening: string | null
          unit_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          agreement_value?: number
          as_at_date: string
          created_at?: string
          cumulative_cgst?: number
          cumulative_receipts?: number
          cumulative_sgst?: number
          cumulative_tds_194ia?: number
          cumulative_value_taxed?: number
          is_affordable_at_opening?: boolean | null
          notes?: string | null
          rate_code_at_opening?: string | null
          unit_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          agreement_value?: number
          as_at_date?: string
          created_at?: string
          cumulative_cgst?: number
          cumulative_receipts?: number
          cumulative_sgst?: number
          cumulative_tds_194ia?: number
          cumulative_value_taxed?: number
          is_affordable_at_opening?: boolean | null
          notes?: string | null
          rate_code_at_opening?: string | null
          unit_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_opening_balances_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: true
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_opening_balances_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: true
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_opening_balances_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: true
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_project_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          project_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          project_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          project_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "builder_project_groups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_project_areas"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "builder_project_groups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_project_groups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_rcm_postings"
            referencedColumns: ["project_id"]
          },
        ]
      }
      builder_projects: {
        Row: {
          carpet_area_source: string
          city: string | null
          client_id: string
          created_at: string
          created_by: string | null
          doc_series_prefix: string | null
          fsi_treatment: string | null
          grouping_label: string
          id: string
          is_metro: boolean
          manual_commercial_carpet_sqm: number
          manual_residential_carpet_sqm: number
          name: string
          notes: string | null
          opening_cutoff_date: string | null
          rera_number: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          carpet_area_source?: string
          city?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          doc_series_prefix?: string | null
          fsi_treatment?: string | null
          grouping_label?: string
          id?: string
          is_metro?: boolean
          manual_commercial_carpet_sqm?: number
          manual_residential_carpet_sqm?: number
          name: string
          notes?: string | null
          opening_cutoff_date?: string | null
          rera_number?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          carpet_area_source?: string
          city?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          doc_series_prefix?: string | null
          fsi_treatment?: string | null
          grouping_label?: string
          id?: string
          is_metro?: boolean
          manual_commercial_carpet_sqm?: number
          manual_residential_carpet_sqm?: number
          name?: string
          notes?: string | null
          opening_cutoff_date?: string | null
          rera_number?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_receipts: {
        Row: {
          amount_entered: number
          amount_is_gst_inclusive: boolean
          bank_credit: number | null
          booking_id: string
          bounced_on: string | null
          cancelled_via_id: string | null
          cgst: number
          cheque_status: string
          consideration: number
          created_at: string
          created_by: string | null
          doc_no: string | null
          doc_series: string | null
          gst_already_discharged: boolean
          id: string
          instrument_ref: string | null
          instrument_type: string
          notes: string | null
          period_month: string
          rate_code: string
          rate_pct: number
          receipt_date: string
          receipt_nature: string
          replaces_receipt_id: string | null
          sgst: number
          subsumed_by_bu_event_id: string | null
          taxable_value: number
          tds_194ia: number
          unit_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount_entered?: number
          amount_is_gst_inclusive?: boolean
          bank_credit?: number | null
          booking_id: string
          bounced_on?: string | null
          cancelled_via_id?: string | null
          cgst?: number
          cheque_status?: string
          consideration?: number
          created_at?: string
          created_by?: string | null
          doc_no?: string | null
          doc_series?: string | null
          gst_already_discharged?: boolean
          id?: string
          instrument_ref?: string | null
          instrument_type?: string
          notes?: string | null
          period_month: string
          rate_code: string
          rate_pct?: number
          receipt_date: string
          receipt_nature?: string
          replaces_receipt_id?: string | null
          sgst?: number
          subsumed_by_bu_event_id?: string | null
          taxable_value?: number
          tds_194ia?: number
          unit_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount_entered?: number
          amount_is_gst_inclusive?: boolean
          bank_credit?: number | null
          booking_id?: string
          bounced_on?: string | null
          cancelled_via_id?: string | null
          cgst?: number
          cheque_status?: string
          consideration?: number
          created_at?: string
          created_by?: string | null
          doc_no?: string | null
          doc_series?: string | null
          gst_already_discharged?: boolean
          id?: string
          instrument_ref?: string | null
          instrument_type?: string
          notes?: string | null
          period_month?: string
          rate_code?: string
          rate_pct?: number
          receipt_date?: string
          receipt_nature?: string
          replaces_receipt_id?: string | null
          sgst?: number
          subsumed_by_bu_event_id?: string | null
          taxable_value?: number
          tds_194ia?: number
          unit_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_receipts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "builder_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_receipts_cancelled_via_id_fkey"
            columns: ["cancelled_via_id"]
            isOneToOne: false
            referencedRelation: "builder_cancellations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_receipts_replaces_receipt_id_fkey"
            columns: ["replaces_receipt_id"]
            isOneToOne: false
            referencedRelation: "builder_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_receipts_subsumed_by_bu_event_id_fkey"
            columns: ["subsumed_by_bu_event_id"]
            isOneToOne: false
            referencedRelation: "builder_bu_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_receipts_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_receipts_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_receipts_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_reclassification_periods: {
        Row: {
          created_at: string
          differential_tax: number
          due_date: string | null
          id: string
          interest_amount: number
          interest_days: number
          new_cgst: number
          new_sgst: number
          old_cgst: number
          old_sgst: number
          period_month: string
          reclassification_id: string
          taxable_value: number
        }
        Insert: {
          created_at?: string
          differential_tax?: number
          due_date?: string | null
          id?: string
          interest_amount?: number
          interest_days?: number
          new_cgst?: number
          new_sgst?: number
          old_cgst?: number
          old_sgst?: number
          period_month: string
          reclassification_id: string
          taxable_value?: number
        }
        Update: {
          created_at?: string
          differential_tax?: number
          due_date?: string | null
          id?: string
          interest_amount?: number
          interest_days?: number
          new_cgst?: number
          new_sgst?: number
          old_cgst?: number
          old_sgst?: number
          period_month?: string
          reclassification_id?: string
          taxable_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "builder_reclassification_periods_reclassification_id_fkey"
            columns: ["reclassification_id"]
            isOneToOne: false
            referencedRelation: "builder_reclassifications"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_reclassifications: {
        Row: {
          created_at: string
          created_by: string | null
          discharge_mode: string
          drc03_arn: string | null
          drc03_filed_by: string | null
          drc03_filed_date: string | null
          drc03_status: string
          from_rate_code: string
          from_rate_pct: number
          gross_after: number
          gross_before: number
          id: string
          posted_at: string | null
          posted_by: string | null
          posting_period: string
          reason: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          status: string
          to_rate_code: string
          to_rate_pct: number
          total_differential_tax: number
          total_interest: number
          total_value_retaxed: number
          triggered_on: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          discharge_mode?: string
          drc03_arn?: string | null
          drc03_filed_by?: string | null
          drc03_filed_date?: string | null
          drc03_status?: string
          from_rate_code: string
          from_rate_pct: number
          gross_after?: number
          gross_before?: number
          id?: string
          posted_at?: string | null
          posted_by?: string | null
          posting_period: string
          reason?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: string
          to_rate_code: string
          to_rate_pct: number
          total_differential_tax?: number
          total_interest?: number
          total_value_retaxed?: number
          triggered_on?: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          discharge_mode?: string
          drc03_arn?: string | null
          drc03_filed_by?: string | null
          drc03_filed_date?: string | null
          drc03_status?: string
          from_rate_code?: string
          from_rate_pct?: number
          gross_after?: number
          gross_before?: number
          id?: string
          posted_at?: string | null
          posted_by?: string | null
          posting_period?: string
          reason?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: string
          to_rate_code?: string
          to_rate_pct?: number
          total_differential_tax?: number
          total_interest?: number
          total_value_retaxed?: number
          triggered_on?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_reclassifications_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: true
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_reclassifications_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: true
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_reclassifications_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: true
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_refund_payments: {
        Row: {
          amount: number
          cancellation_id: string
          created_at: string
          created_by: string | null
          email_outbox_id: string | null
          forfeited_amount: number
          id: string
          instrument_ref: string | null
          instrument_type: string | null
          notes: string | null
          offset_amount: number
          offset_cgst: number
          offset_sgst: number
          offset_taxable_value: number
          payment_date: string
          period_month: string
        }
        Insert: {
          amount: number
          cancellation_id: string
          created_at?: string
          created_by?: string | null
          email_outbox_id?: string | null
          forfeited_amount?: number
          id?: string
          instrument_ref?: string | null
          instrument_type?: string | null
          notes?: string | null
          offset_amount?: number
          offset_cgst?: number
          offset_sgst?: number
          offset_taxable_value?: number
          payment_date: string
          period_month: string
        }
        Update: {
          amount?: number
          cancellation_id?: string
          created_at?: string
          created_by?: string | null
          email_outbox_id?: string | null
          forfeited_amount?: number
          id?: string
          instrument_ref?: string | null
          instrument_type?: string | null
          notes?: string | null
          offset_amount?: number
          offset_cgst?: number
          offset_sgst?: number
          offset_taxable_value?: number
          payment_date?: string
          period_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_refund_payments_cancellation_id_fkey"
            columns: ["cancellation_id"]
            isOneToOne: false
            referencedRelation: "builder_cancellations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_refund_payments_email_outbox_id_fkey"
            columns: ["email_outbox_id"]
            isOneToOne: false
            referencedRelation: "email_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_unit_charges: {
        Row: {
          amount: number
          charge_head: string
          created_at: string
          id: string
          include_override: boolean | null
          label: string | null
          unit_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          charge_head: string
          created_at?: string
          id?: string
          include_override?: boolean | null
          label?: string | null
          unit_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          charge_head?: string
          created_at?: string
          id?: string
          include_override?: boolean | null
          label?: string | null
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_unit_charges_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_unit_charges_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_unit_charges_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_unit_classification_history: {
        Row: {
          area_limit_sqm: number
          carpet_area_sqm: number
          created_at: string
          created_by: string | null
          effective_from: string
          effective_rate_pct: number
          gross_consideration: number
          id: string
          is_affordable: boolean
          is_rrep: boolean
          note: string | null
          rate_code: string
          rate_pct: number
          reason: string
          unit_id: string
        }
        Insert: {
          area_limit_sqm?: number
          carpet_area_sqm?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_rate_pct: number
          gross_consideration?: number
          id?: string
          is_affordable: boolean
          is_rrep?: boolean
          note?: string | null
          rate_code: string
          rate_pct: number
          reason?: string
          unit_id: string
        }
        Update: {
          area_limit_sqm?: number
          carpet_area_sqm?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_rate_pct?: number
          gross_consideration?: number
          id?: string
          is_affordable?: boolean
          is_rrep?: boolean
          note?: string | null
          rate_code?: string
          rate_pct?: number
          reason?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_unit_classification_history_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_dastavej_reco"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_unit_classification_history_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_unit_ledger"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "builder_unit_classification_history_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "builder_units"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_units: {
        Row: {
          base_consideration: number
          bu_event_id: string | null
          carpet_area_sqm: number
          created_at: string
          created_by: string | null
          dastavej_date: string | null
          dastavej_value: number | null
          group_id: string | null
          id: string
          notes: string | null
          onboarding_status: string
          project_id: string
          sort_order: number
          status: string
          unit_no: string
          unit_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          base_consideration?: number
          bu_event_id?: string | null
          carpet_area_sqm?: number
          created_at?: string
          created_by?: string | null
          dastavej_date?: string | null
          dastavej_value?: number | null
          group_id?: string | null
          id?: string
          notes?: string | null
          onboarding_status?: string
          project_id: string
          sort_order?: number
          status?: string
          unit_no: string
          unit_type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          base_consideration?: number
          bu_event_id?: string | null
          carpet_area_sqm?: number
          created_at?: string
          created_by?: string | null
          dastavej_date?: string | null
          dastavej_value?: number | null
          group_id?: string | null
          id?: string
          notes?: string | null
          onboarding_status?: string
          project_id?: string
          sort_order?: number
          status?: string
          unit_no?: string
          unit_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_units_bu_event_id_fkey"
            columns: ["bu_event_id"]
            isOneToOne: false
            referencedRelation: "builder_bu_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_units_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "builder_project_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_project_areas"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "builder_units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_rcm_postings"
            referencedColumns: ["project_id"]
          },
        ]
      }
      chat_channel_members: {
        Row: {
          channel_id: string
          id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          id?: string
          joined_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          id?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channel_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channel_messages: {
        Row: {
          channel_id: string
          created_at: string
          id: string
          mentions: string[] | null
          message: string
          sender_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          id?: string
          mentions?: string[] | null
          message: string
          sender_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          id?: string
          mentions?: string[] | null
          message?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channel_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channel_read_status: {
        Row: {
          channel_id: string
          id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          id?: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channel_read_status_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channels: {
        Row: {
          channel_type: string
          created_at: string
          created_by: string | null
          id: string
          name: string | null
        }
        Insert: {
          channel_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string | null
        }
        Update: {
          channel_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string | null
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          created_at: string
          id: string
          mentions: string[] | null
          message: string
          sender_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mentions?: string[] | null
          message: string
          sender_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mentions?: string[] | null
          message?: string
          sender_id?: string
        }
        Relationships: []
      }
      chat_read_status: {
        Row: {
          id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          id?: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: []
      }
      client_annual_turnover: {
        Row: {
          aggregate_turnover: number | null
          applicability_note: string | null
          client_id: string
          created_at: string
          entered_by: string | null
          exempt_turnover: number | null
          financial_year: string
          gstr9_opt_in: boolean
          gstr9c_opt_in: boolean
          id: string
          itc_directly_attributable_exempt: number | null
          updated_at: string
          updated_by_name: string | null
        }
        Insert: {
          aggregate_turnover?: number | null
          applicability_note?: string | null
          client_id: string
          created_at?: string
          entered_by?: string | null
          exempt_turnover?: number | null
          financial_year: string
          gstr9_opt_in?: boolean
          gstr9c_opt_in?: boolean
          id?: string
          itc_directly_attributable_exempt?: number | null
          updated_at?: string
          updated_by_name?: string | null
        }
        Update: {
          aggregate_turnover?: number | null
          applicability_note?: string | null
          client_id?: string
          created_at?: string
          entered_by?: string | null
          exempt_turnover?: number | null
          financial_year?: string
          gstr9_opt_in?: boolean
          gstr9c_opt_in?: boolean
          id?: string
          itc_directly_attributable_exempt?: number | null
          updated_at?: string
          updated_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_annual_turnover_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_reminder_settings: {
        Row: {
          client_id: string
          enabled: boolean
          escalate: boolean
          interval_days: number
          max_reminders: number | null
          send_confirmation: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          enabled?: boolean
          escalate?: boolean
          interval_days?: number
          max_reminders?: number | null
          send_confirmation?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          enabled?: boolean
          escalate?: boolean
          interval_days?: number
          max_reminders?: number | null
          send_confirmation?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_reminder_settings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_scheme_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          client_id: string
          effective_from_date: string
          id: string
          new_scheme: string
          notes: string | null
          old_scheme: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          client_id: string
          effective_from_date: string
          id?: string
          new_scheme: string
          notes?: string | null
          old_scheme: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          client_id?: string
          effective_from_date?: string
          id?: string
          new_scheme?: string
          notes?: string | null
          old_scheme?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_scheme_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_sync_log: {
        Row: {
          action: string
          client_id: string
          created_at: string
          id: string
          message: string | null
          status: string
        }
        Insert: {
          action: string
          client_id: string
          created_at?: string
          id?: string
          message?: string | null
          status: string
        }
        Update: {
          action?: string
          client_id?: string
          created_at?: string
          id?: string
          message?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_sync_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          ai_learning: boolean
          ai_learning_at: string | null
          ai_learning_by_name: string | null
          ai_consent_at: string | null
          ai_consent_note: string | null
          ai_opt_out: boolean
          assigned_accountant: string | null
          builder_itc_type: string | null
          cancellation_date: string | null
          client_password: string | null
          client_user_id: string | null
          commercial_area: number | null
          created_at: string | null
          created_by: string | null
          einvoice_applicable: boolean
          einvoice_exemption: string | null
          email: string | null
          gst_password: string | null
          gst_password_changed_at: string | null
          gst_user_id: string | null
          gstin: string
          gstr1_import_mode: string
          id: string
          inactive_at_hand: boolean
          is_first_login: boolean | null
          liberal_2b_reconciliation: boolean
          mobile: string | null
          name: string
          notices_handled: boolean
          notices_sync_excluded: boolean
          portal_login_issue: string | null
          portal_login_issue_at: string | null
          portal_login_issue_message: string | null
          registration_cancellation_date: string | null
          registration_date: string
          registration_type: Database["public"]["Enums"]["registration_type"]
          regular_sub_type: string | null
          residential_area: number | null
          selected_returns: Database["public"]["Enums"]["return_type"][] | null
          target_date_group1: number | null
          target_date_group2: number | null
          updated_at: string | null
        }
        Insert: {
          ai_learning?: boolean
          ai_learning_at?: string | null
          ai_learning_by_name?: string | null
          ai_consent_at?: string | null
          ai_consent_note?: string | null
          ai_opt_out?: boolean
          assigned_accountant?: string | null
          builder_itc_type?: string | null
          cancellation_date?: string | null
          client_password?: string | null
          client_user_id?: string | null
          commercial_area?: number | null
          created_at?: string | null
          created_by?: string | null
          einvoice_applicable?: boolean
          einvoice_exemption?: string | null
          email?: string | null
          gst_password?: string | null
          gst_password_changed_at?: string | null
          gst_user_id?: string | null
          gstin: string
          gstr1_import_mode?: string
          id?: string
          inactive_at_hand?: boolean
          is_first_login?: boolean | null
          liberal_2b_reconciliation?: boolean
          mobile?: string | null
          name: string
          notices_handled?: boolean
          notices_sync_excluded?: boolean
          portal_login_issue?: string | null
          portal_login_issue_at?: string | null
          portal_login_issue_message?: string | null
          registration_cancellation_date?: string | null
          registration_date: string
          registration_type?: Database["public"]["Enums"]["registration_type"]
          regular_sub_type?: string | null
          residential_area?: number | null
          selected_returns?: Database["public"]["Enums"]["return_type"][] | null
          target_date_group1?: number | null
          target_date_group2?: number | null
          updated_at?: string | null
        }
        Update: {
          ai_learning?: boolean
          ai_learning_at?: string | null
          ai_learning_by_name?: string | null
          ai_consent_at?: string | null
          ai_consent_note?: string | null
          ai_opt_out?: boolean
          assigned_accountant?: string | null
          builder_itc_type?: string | null
          cancellation_date?: string | null
          client_password?: string | null
          client_user_id?: string | null
          commercial_area?: number | null
          created_at?: string | null
          created_by?: string | null
          einvoice_applicable?: boolean
          einvoice_exemption?: string | null
          email?: string | null
          gst_password?: string | null
          gst_password_changed_at?: string | null
          gst_user_id?: string | null
          gstin?: string
          gstr1_import_mode?: string
          id?: string
          inactive_at_hand?: boolean
          is_first_login?: boolean | null
          liberal_2b_reconciliation?: boolean
          mobile?: string | null
          name?: string
          notices_handled?: boolean
          notices_sync_excluded?: boolean
          portal_login_issue?: string | null
          portal_login_issue_at?: string | null
          portal_login_issue_message?: string | null
          registration_cancellation_date?: string | null
          registration_date?: string
          registration_type?: Database["public"]["Enums"]["registration_type"]
          regular_sub_type?: string | null
          residential_area?: number | null
          selected_returns?: Database["public"]["Enums"]["return_type"][] | null
          target_date_group1?: number | null
          target_date_group2?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      duties_taxes_input_monthly: {
        Row: {
          as_per_3b_cgst: number
          as_per_3b_igst: number
          as_per_3b_sgst: number
          client_id: string
          created_at: string
          debit_note_cgst: number
          debit_note_igst: number
          debit_note_sgst: number
          entered_by: string | null
          financial_year: string
          id: string
          month: string
          other_adjustment_cgst: number
          other_adjustment_igst: number
          other_adjustment_reason: string | null
          other_adjustment_sgst: number
          purchase_cgst: number
          purchase_igst: number
          purchase_sgst: number
          suspended_reclaim_180d_cgst: number
          suspended_reclaim_180d_igst: number
          suspended_reclaim_180d_sgst: number
          suspended_reclaim_cgst: number
          suspended_reclaim_igst: number
          suspended_reclaim_sgst: number
          suspended_reversed_180d_cgst: number
          suspended_reversed_180d_igst: number
          suspended_reversed_180d_sgst: number
          suspended_reversed_cgst: number
          suspended_reversed_igst: number
          suspended_reversed_sgst: number
          updated_at: string
        }
        Insert: {
          as_per_3b_cgst?: number
          as_per_3b_igst?: number
          as_per_3b_sgst?: number
          client_id: string
          created_at?: string
          debit_note_cgst?: number
          debit_note_igst?: number
          debit_note_sgst?: number
          entered_by?: string | null
          financial_year: string
          id?: string
          month: string
          other_adjustment_cgst?: number
          other_adjustment_igst?: number
          other_adjustment_reason?: string | null
          other_adjustment_sgst?: number
          purchase_cgst?: number
          purchase_igst?: number
          purchase_sgst?: number
          suspended_reclaim_180d_cgst?: number
          suspended_reclaim_180d_igst?: number
          suspended_reclaim_180d_sgst?: number
          suspended_reclaim_cgst?: number
          suspended_reclaim_igst?: number
          suspended_reclaim_sgst?: number
          suspended_reversed_180d_cgst?: number
          suspended_reversed_180d_igst?: number
          suspended_reversed_180d_sgst?: number
          suspended_reversed_cgst?: number
          suspended_reversed_igst?: number
          suspended_reversed_sgst?: number
          updated_at?: string
        }
        Update: {
          as_per_3b_cgst?: number
          as_per_3b_igst?: number
          as_per_3b_sgst?: number
          client_id?: string
          created_at?: string
          debit_note_cgst?: number
          debit_note_igst?: number
          debit_note_sgst?: number
          entered_by?: string | null
          financial_year?: string
          id?: string
          month?: string
          other_adjustment_cgst?: number
          other_adjustment_igst?: number
          other_adjustment_reason?: string | null
          other_adjustment_sgst?: number
          purchase_cgst?: number
          purchase_igst?: number
          purchase_sgst?: number
          suspended_reclaim_180d_cgst?: number
          suspended_reclaim_180d_igst?: number
          suspended_reclaim_180d_sgst?: number
          suspended_reclaim_cgst?: number
          suspended_reclaim_igst?: number
          suspended_reclaim_sgst?: number
          suspended_reversed_180d_cgst?: number
          suspended_reversed_180d_igst?: number
          suspended_reversed_180d_sgst?: number
          suspended_reversed_cgst?: number
          suspended_reversed_igst?: number
          suspended_reversed_sgst?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "duties_taxes_input_monthly_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      duties_taxes_output_monthly: {
        Row: {
          as_per_3b_cgst: number
          as_per_3b_igst: number
          as_per_3b_sgst: number
          client_id: string
          created_at: string
          credit_note_cgst: number
          credit_note_igst: number
          credit_note_sgst: number
          entered_by: string | null
          financial_year: string
          id: string
          month: string
          other_adjustment_cgst: number
          other_adjustment_igst: number
          other_adjustment_reason: string | null
          other_adjustment_sgst: number
          sales_cgst: number
          sales_igst: number
          sales_sgst: number
          updated_at: string
        }
        Insert: {
          as_per_3b_cgst?: number
          as_per_3b_igst?: number
          as_per_3b_sgst?: number
          client_id: string
          created_at?: string
          credit_note_cgst?: number
          credit_note_igst?: number
          credit_note_sgst?: number
          entered_by?: string | null
          financial_year: string
          id?: string
          month: string
          other_adjustment_cgst?: number
          other_adjustment_igst?: number
          other_adjustment_reason?: string | null
          other_adjustment_sgst?: number
          sales_cgst?: number
          sales_igst?: number
          sales_sgst?: number
          updated_at?: string
        }
        Update: {
          as_per_3b_cgst?: number
          as_per_3b_igst?: number
          as_per_3b_sgst?: number
          client_id?: string
          created_at?: string
          credit_note_cgst?: number
          credit_note_igst?: number
          credit_note_sgst?: number
          entered_by?: string | null
          financial_year?: string
          id?: string
          month?: string
          other_adjustment_cgst?: number
          other_adjustment_igst?: number
          other_adjustment_reason?: string | null
          other_adjustment_sgst?: number
          sales_cgst?: number
          sales_igst?: number
          sales_sgst?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "duties_taxes_output_monthly_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbox: {
        Row: {
          body: string
          client_id: string | null
          created_at: string
          created_by: string | null
          dedupe_key: string | null
          error: string | null
          filing_status_id: string | null
          id: string
          kind: string
          matter_id: string | null
          notice_id: string | null
          period_month: string | null
          reminder_step: number | null
          render_vars: Json | null
          return_type: Database["public"]["Enums"]["return_type"] | null
          sent_at: string | null
          status: string
          subject: string
          template_key: string
          to_email: string
        }
        Insert: {
          body: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          filing_status_id?: string | null
          dedupe_key?: string | null
          id?: string
          kind: string
          matter_id?: string | null
          notice_id?: string | null
          period_month?: string | null
          reminder_step?: number | null
          render_vars?: Json | null
          return_type?: Database["public"]["Enums"]["return_type"] | null
          sent_at?: string | null
          status?: string
          subject: string
          template_key: string
          to_email: string
        }
        Update: {
          body?: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          dedupe_key?: string | null
          error?: string | null
          filing_status_id?: string | null
          id?: string
          kind?: string
          matter_id?: string | null
          notice_id?: string | null
          period_month?: string | null
          reminder_step?: number | null
          render_vars?: Json | null
          return_type?: Database["public"]["Enums"]["return_type"] | null
          sent_at?: string | null
          status?: string
          subject?: string
          template_key?: string
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_filing_status_id_fkey"
            columns: ["filing_status_id"]
            isOneToOne: false
            referencedRelation: "filing_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_template_key_fkey"
            columns: ["template_key"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["key"]
          },
        ]
      }
      email_templates: {
        Row: {
          body: string
          is_active: boolean
          key: string
          kind: string
          name: string
          sort_order: number
          step: number | null
          subject: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body: string
          is_active?: boolean
          key: string
          kind: string
          name: string
          sort_order?: number
          step?: number | null
          subject: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          is_active?: boolean
          key?: string
          kind?: string
          name?: string
          sort_order?: number
          step?: number | null
          subject?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      expense_head_mappings: {
        Row: {
          client_id: string
          expense_head: string
          id: string
          ledger_head: string
          updated_at: string
        }
        Insert: {
          client_id: string
          expense_head: string
          id?: string
          ledger_head: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          expense_head?: string
          id?: string
          ledger_head?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_head_mappings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      filing_status: {
        Row: {
          arn: string | null
          client_id: string
          filed_date: string | null
          id: string
          is_locked: boolean | null
          is_nil: boolean
          period_month: string
          pushed_at: string | null
          remarks: string | null
          return_pdf_url: string | null
          return_type: Database["public"]["Enums"]["return_type"]
          status: Database["public"]["Enums"]["filing_status_type"] | null
          target_date: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          arn?: string | null
          client_id: string
          filed_date?: string | null
          id?: string
          is_locked?: boolean | null
          is_nil?: boolean
          period_month: string
          pushed_at?: string | null
          remarks?: string | null
          return_pdf_url?: string | null
          return_type: Database["public"]["Enums"]["return_type"]
          status?: Database["public"]["Enums"]["filing_status_type"] | null
          target_date?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          arn?: string | null
          client_id?: string
          filed_date?: string | null
          id?: string
          is_locked?: boolean | null
          is_nil?: boolean
          period_month?: string
          pushed_at?: string | null
          remarks?: string | null
          return_pdf_url?: string | null
          return_type?: Database["public"]["Enums"]["return_type"]
          status?: Database["public"]["Enums"]["filing_status_type"] | null
          target_date?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "filing_status_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_case_folder_items: {
        Row: {
          attachments: Json
          case_id: string
          client_id: string
          deleted_at: string | null
          first_seen_at: string
          folder_section: string | null
          id: string
          last_seen_at: string
          portal_key: string
          pulled_at: string
          raw_json: Json | null
          reference_number: string | null
          portal_hash: string | null
        }
        Insert: {
          attachments?: Json
          case_id: string
          client_id: string
          deleted_at?: string | null
          first_seen_at?: string
          folder_section?: string | null
          id?: string
          last_seen_at?: string
          portal_key: string
          pulled_at?: string
          raw_json?: Json | null
          reference_number?: string | null
          portal_hash?: string | null
        }
        Update: {
          attachments?: Json
          case_id?: string
          client_id?: string
          deleted_at?: string | null
          first_seen_at?: string
          folder_section?: string | null
          id?: string
          last_seen_at?: string
          portal_key?: string
          pulled_at?: string
          raw_json?: Json | null
          reference_number?: string | null
          portal_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gst_case_folder_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_cash_ledger_entries: {
        Row: {
          balance: number | null
          cess: number | null
          cgst: number | null
          client_id: string
          created_at: string
          description: string | null
          entry_date: string | null
          id: string
          igst: number | null
          is_debit: boolean | null
          period_month: string
          pulled_at: string
          sgst: number | null
        }
        Insert: {
          balance?: number | null
          cess?: number | null
          cgst?: number | null
          client_id: string
          created_at?: string
          description?: string | null
          entry_date?: string | null
          id?: string
          igst?: number | null
          is_debit?: boolean | null
          period_month: string
          pulled_at?: string
          sgst?: number | null
        }
        Update: {
          balance?: number | null
          cess?: number | null
          cgst?: number | null
          client_id?: string
          created_at?: string
          description?: string | null
          entry_date?: string | null
          id?: string
          igst?: number | null
          is_debit?: boolean | null
          period_month?: string
          pulled_at?: string
          sgst?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gst_cash_ledger_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_challans: {
        Row: {
          cess_amount: number | null
          cgst_amount: number | null
          challan_date: string | null
          client_id: string
          cpin: string | null
          created_at: string
          id: string
          igst_amount: number | null
          payment_mode: string | null
          pulled_at: string
          pulled_by: string | null
          sgst_amount: number | null
          status: string | null
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          cess_amount?: number | null
          cgst_amount?: number | null
          challan_date?: string | null
          client_id: string
          cpin?: string | null
          created_at?: string
          id?: string
          igst_amount?: number | null
          payment_mode?: string | null
          pulled_at?: string
          pulled_by?: string | null
          sgst_amount?: number | null
          status?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          cess_amount?: number | null
          cgst_amount?: number | null
          challan_date?: string | null
          client_id?: string
          cpin?: string | null
          created_at?: string
          id?: string
          igst_amount?: number | null
          payment_mode?: string | null
          pulled_at?: string
          pulled_by?: string | null
          sgst_amount?: number | null
          status?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gst_challans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_credit_ledger_transactions: {
        Row: {
          cgst: number | null
          client_id: string
          created_at: string
          description: string | null
          id: string
          igst: number | null
          is_debit: boolean
          period_month: string
          pulled_at: string
          sgst: number | null
        }
        Insert: {
          cgst?: number | null
          client_id: string
          created_at?: string
          description?: string | null
          id?: string
          igst?: number | null
          is_debit: boolean
          period_month: string
          pulled_at?: string
          sgst?: number | null
        }
        Update: {
          cgst?: number | null
          client_id?: string
          created_at?: string
          description?: string | null
          id?: string
          igst?: number | null
          is_debit?: boolean
          period_month?: string
          pulled_at?: string
          sgst?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gst_credit_ledger_transactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_credit_reversal_reclaim_entries: {
        Row: {
          client_id: string
          closing_balance_cess: number | null
          closing_balance_cgst: number | null
          closing_balance_igst: number | null
          closing_balance_sgst: number | null
          created_at: string
          description: string | null
          financial_year: string
          id: string
          is_opening_balance: boolean
          itc_claimed_cess: number | null
          itc_claimed_cgst: number | null
          itc_claimed_igst: number | null
          itc_claimed_sgst: number | null
          itc_reclaimed_cess: number | null
          itc_reclaimed_cgst: number | null
          itc_reclaimed_igst: number | null
          itc_reclaimed_sgst: number | null
          itc_reversed_cess: number | null
          itc_reversed_cgst: number | null
          itc_reversed_igst: number | null
          itc_reversed_sgst: number | null
          pulled_at: string
          reference_no: string | null
          return_period: string | null
          transaction_date: string | null
        }
        Insert: {
          client_id: string
          closing_balance_cess?: number | null
          closing_balance_cgst?: number | null
          closing_balance_igst?: number | null
          closing_balance_sgst?: number | null
          created_at?: string
          description?: string | null
          financial_year: string
          id?: string
          is_opening_balance?: boolean
          itc_claimed_cess?: number | null
          itc_claimed_cgst?: number | null
          itc_claimed_igst?: number | null
          itc_claimed_sgst?: number | null
          itc_reclaimed_cess?: number | null
          itc_reclaimed_cgst?: number | null
          itc_reclaimed_igst?: number | null
          itc_reclaimed_sgst?: number | null
          itc_reversed_cess?: number | null
          itc_reversed_cgst?: number | null
          itc_reversed_igst?: number | null
          itc_reversed_sgst?: number | null
          pulled_at?: string
          reference_no?: string | null
          return_period?: string | null
          transaction_date?: string | null
        }
        Update: {
          client_id?: string
          closing_balance_cess?: number | null
          closing_balance_cgst?: number | null
          closing_balance_igst?: number | null
          closing_balance_sgst?: number | null
          created_at?: string
          description?: string | null
          financial_year?: string
          id?: string
          is_opening_balance?: boolean
          itc_claimed_cess?: number | null
          itc_claimed_cgst?: number | null
          itc_claimed_igst?: number | null
          itc_claimed_sgst?: number | null
          itc_reclaimed_cess?: number | null
          itc_reclaimed_cgst?: number | null
          itc_reclaimed_igst?: number | null
          itc_reclaimed_sgst?: number | null
          itc_reversed_cess?: number | null
          itc_reversed_cgst?: number | null
          itc_reversed_igst?: number | null
          itc_reversed_sgst?: number | null
          pulled_at?: string
          reference_no?: string | null
          return_period?: string | null
          transaction_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gst_credit_reversal_reclaim_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_drc03_filings: {
        Row: {
          arn: string | null
          cash_amount: number | null
          cause_of_payment: string | null
          cess_amount: number | null
          cgst_amount: number | null
          client_id: string
          created_at: string
          credit_amount: number | null
          deleted_at: string | null
          filed_date: string | null
          financial_year: string | null
          first_seen_at: string
          id: string
          igst_amount: number | null
          interest_amount: number | null
          last_seen_at: string
          late_fee_amount: number | null
          pdf_url: string | null
          penalty_amount: number | null
          period_from: string | null
          period_to: string | null
          portal_key: string
          pulled_at: string
          pulled_by: string | null
          section: string | null
          sgst_amount: number | null
          status: string | null
          taxable_value: number | null
          updated_at: string
          portal_hash: string | null
        }
        Insert: {
          arn?: string | null
          cash_amount?: number | null
          cause_of_payment?: string | null
          cess_amount?: number | null
          cgst_amount?: number | null
          client_id: string
          created_at?: string
          credit_amount?: number | null
          deleted_at?: string | null
          filed_date?: string | null
          financial_year?: string | null
          first_seen_at?: string
          id?: string
          igst_amount?: number | null
          interest_amount?: number | null
          last_seen_at?: string
          late_fee_amount?: number | null
          pdf_url?: string | null
          penalty_amount?: number | null
          period_from?: string | null
          period_to?: string | null
          portal_key: string
          pulled_at?: string
          pulled_by?: string | null
          section?: string | null
          sgst_amount?: number | null
          status?: string | null
          taxable_value?: number | null
          updated_at?: string
          portal_hash?: string | null
        }
        Update: {
          arn?: string | null
          cash_amount?: number | null
          cause_of_payment?: string | null
          cess_amount?: number | null
          cgst_amount?: number | null
          client_id?: string
          created_at?: string
          credit_amount?: number | null
          deleted_at?: string | null
          filed_date?: string | null
          financial_year?: string | null
          first_seen_at?: string
          id?: string
          igst_amount?: number | null
          interest_amount?: number | null
          last_seen_at?: string
          late_fee_amount?: number | null
          pdf_url?: string | null
          penalty_amount?: number | null
          period_from?: string | null
          period_to?: string | null
          portal_key?: string
          pulled_at?: string
          pulled_by?: string | null
          section?: string | null
          sgst_amount?: number | null
          status?: string | null
          taxable_value?: number | null
          updated_at?: string
          portal_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gst_drc03_filings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_filed_returns: {
        Row: {
          arn: string | null
          client_id: string
          created_at: string
          filed_date: string | null
          full_json: Json | null
          full_json_pulled_at: string | null
          id: string
          period_month: string
          return_type: string
          status: string | null
          summary: Json
          updated_at: string
        }
        Insert: {
          arn?: string | null
          client_id: string
          created_at?: string
          filed_date?: string | null
          full_json?: Json | null
          full_json_pulled_at?: string | null
          id?: string
          period_month: string
          return_type: string
          status?: string | null
          summary?: Json
          updated_at?: string
        }
        Update: {
          arn?: string | null
          client_id?: string
          created_at?: string
          filed_date?: string | null
          full_json?: Json | null
          full_json_pulled_at?: string | null
          id?: string
          period_month?: string
          return_type?: string
          status?: string | null
          summary?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gst_filed_returns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_liability_ledger_entries: {
        Row: {
          balance: number | null
          cess: number | null
          cgst: number | null
          client_id: string
          created_at: string
          description: string | null
          entry_date: string | null
          id: string
          igst: number | null
          is_debit: boolean | null
          period_month: string
          pulled_at: string
          sgst: number | null
        }
        Insert: {
          balance?: number | null
          cess?: number | null
          cgst?: number | null
          client_id: string
          created_at?: string
          description?: string | null
          entry_date?: string | null
          id?: string
          igst?: number | null
          is_debit?: boolean | null
          period_month: string
          pulled_at?: string
          sgst?: number | null
        }
        Update: {
          balance?: number | null
          cess?: number | null
          cgst?: number | null
          client_id?: string
          created_at?: string
          description?: string | null
          entry_date?: string | null
          id?: string
          igst?: number | null
          is_debit?: boolean | null
          period_month?: string
          pulled_at?: string
          sgst?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gst_liability_ledger_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_notices: {
        Row: {
          amount_of_demand: number | null
          assign_to: string | null
          assign_to_user_id: string | null
          case_id: string | null
          client_id: string
          created_at: string
          deleted_at: string | null
          description: string | null
          due_date: string | null
          extended_due_date: string | null
          financial_year: string | null
          first_seen_at: string
          hearing_date: string | null
          id: string
          issue_date: string | null
          issued_by: string | null
          last_seen_at: string
          matter_id: string | null
          notice_type: string | null
          order_date: string | null
          order_number: string | null
          pdf_url: string | null
          portal_key: string
          priority: string | null
          pulled_at: string
          pulled_by: string | null
          reference_number: string | null
          remarks: string | null
          reply_date: string | null
          reply_ref_number: string | null
          source: string
          staff_status: string | null
          close_reason: string | null
          status: string | null
          submission_arn: string | null
          submission_date: string | null
          updated_at: string
          form_code: string | null
          edited_by_id: string | null
          edited_by_name: string | null
          edited_at: string | null
          due_date_source: string | null
          portal_hash: string | null
          stage: string
          stage_changed_at: string | null
          stage_changed_by: string | null
          hearing_note: string | null
          portal_detail: Json | null
          section_of_law: string | null
          period_from: string | null
          period_to: string | null
          din: string | null
          demand: Json | null
          demand_total: number | null
          read_fields: Json
        }
        Insert: {
          amount_of_demand?: number | null
          assign_to?: string | null
          assign_to_user_id?: string | null
          case_id?: string | null
          client_id: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          extended_due_date?: string | null
          financial_year?: string | null
          first_seen_at?: string
          hearing_date?: string | null
          id?: string
          issue_date?: string | null
          issued_by?: string | null
          last_seen_at?: string
          matter_id?: string | null
          notice_type?: string | null
          order_date?: string | null
          order_number?: string | null
          pdf_url?: string | null
          portal_key: string
          priority?: string | null
          pulled_at?: string
          pulled_by?: string | null
          reference_number?: string | null
          remarks?: string | null
          reply_date?: string | null
          reply_ref_number?: string | null
          source?: string
          staff_status?: string | null
          close_reason?: string | null
          status?: string | null
          submission_arn?: string | null
          submission_date?: string | null
          updated_at?: string
          form_code?: string | null
          edited_by_id?: string | null
          edited_by_name?: string | null
          edited_at?: string | null
          due_date_source?: string | null
          portal_hash?: string | null
          stage?: string
          stage_changed_at?: string | null
          stage_changed_by?: string | null
          hearing_note?: string | null
          portal_detail?: Json | null
          section_of_law?: string | null
          period_from?: string | null
          period_to?: string | null
          din?: string | null
          demand?: Json | null
          demand_total?: number | null
          read_fields?: Json
        }
        Update: {
          amount_of_demand?: number | null
          assign_to?: string | null
          assign_to_user_id?: string | null
          case_id?: string | null
          client_id?: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          extended_due_date?: string | null
          financial_year?: string | null
          first_seen_at?: string
          hearing_date?: string | null
          id?: string
          issue_date?: string | null
          issued_by?: string | null
          last_seen_at?: string
          matter_id?: string | null
          notice_type?: string | null
          order_date?: string | null
          order_number?: string | null
          pdf_url?: string | null
          portal_key?: string
          priority?: string | null
          pulled_at?: string
          pulled_by?: string | null
          reference_number?: string | null
          remarks?: string | null
          reply_date?: string | null
          reply_ref_number?: string | null
          source?: string
          staff_status?: string | null
          close_reason?: string | null
          status?: string | null
          submission_arn?: string | null
          submission_date?: string | null
          updated_at?: string
          form_code?: string | null
          edited_by_id?: string | null
          edited_by_name?: string | null
          edited_at?: string | null
          due_date_source?: string | null
          portal_hash?: string | null
          stage?: string
          stage_changed_at?: string | null
          stage_changed_by?: string | null
          hearing_note?: string | null
          portal_detail?: Json | null
          section_of_law?: string | null
          period_from?: string | null
          period_to?: string | null
          din?: string | null
          demand?: Json | null
          demand_total?: number | null
          read_fields?: Json
        }
        Relationships: [
          {
            foreignKeyName: "gst_notices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_rcm_liability_itc_entries: {
        Row: {
          client_id: string
          closing_balance_cess: number | null
          closing_balance_cgst: number | null
          closing_balance_igst: number | null
          closing_balance_sgst: number | null
          created_at: string
          description: string | null
          financial_year: string
          id: string
          is_opening_balance: boolean
          itc_4a2_cess: number | null
          itc_4a2_igst: number | null
          itc_4a3_cess: number | null
          itc_4a3_cgst: number | null
          itc_4a3_igst: number | null
          itc_4a3_sgst: number | null
          liability_3_1d_cess: number | null
          liability_3_1d_cgst: number | null
          liability_3_1d_igst: number | null
          liability_3_1d_sgst: number | null
          pulled_at: string
          reference_no: string | null
          return_period: string | null
          transaction_date: string | null
        }
        Insert: {
          client_id: string
          closing_balance_cess?: number | null
          closing_balance_cgst?: number | null
          closing_balance_igst?: number | null
          closing_balance_sgst?: number | null
          created_at?: string
          description?: string | null
          financial_year: string
          id?: string
          is_opening_balance?: boolean
          itc_4a2_cess?: number | null
          itc_4a2_igst?: number | null
          itc_4a3_cess?: number | null
          itc_4a3_cgst?: number | null
          itc_4a3_igst?: number | null
          itc_4a3_sgst?: number | null
          liability_3_1d_cess?: number | null
          liability_3_1d_cgst?: number | null
          liability_3_1d_igst?: number | null
          liability_3_1d_sgst?: number | null
          pulled_at?: string
          reference_no?: string | null
          return_period?: string | null
          transaction_date?: string | null
        }
        Update: {
          client_id?: string
          closing_balance_cess?: number | null
          closing_balance_cgst?: number | null
          closing_balance_igst?: number | null
          closing_balance_sgst?: number | null
          created_at?: string
          description?: string | null
          financial_year?: string
          id?: string
          is_opening_balance?: boolean
          itc_4a2_cess?: number | null
          itc_4a2_igst?: number | null
          itc_4a3_cess?: number | null
          itc_4a3_cgst?: number | null
          itc_4a3_igst?: number | null
          itc_4a3_sgst?: number | null
          liability_3_1d_cess?: number | null
          liability_3_1d_cgst?: number | null
          liability_3_1d_igst?: number | null
          liability_3_1d_sgst?: number | null
          pulled_at?: string
          reference_no?: string | null
          return_period?: string | null
          transaction_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gst_rcm_liability_itc_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_receivable_reco: {
        Row: {
          books_closing_cgst: number | null
          books_closing_igst: number | null
          books_closing_sgst: number | null
          client_id: string
          drc_cgst: number | null
          drc_igst: number | null
          drc_sgst: number | null
          id: string
          opening_cgst: number | null
          opening_csv_period_month: string | null
          opening_csv_uploaded_at: string | null
          opening_csv_uploaded_by: string | null
          opening_igst: number | null
          opening_override_at: string | null
          opening_override_by: string | null
          opening_override_justification: string | null
          opening_portal_pulled_at: string | null
          opening_portal_pulled_by: string | null
          opening_sgst: number | null
          opening_source: string
          period_month: string
          updated_at: string | null
          updated_by: string | null
          utilized_cgst: number | null
          utilized_igst: number | null
          utilized_sgst: number | null
        }
        Insert: {
          books_closing_cgst?: number | null
          books_closing_igst?: number | null
          books_closing_sgst?: number | null
          client_id: string
          drc_cgst?: number | null
          drc_igst?: number | null
          drc_sgst?: number | null
          id?: string
          opening_cgst?: number | null
          opening_csv_period_month?: string | null
          opening_csv_uploaded_at?: string | null
          opening_csv_uploaded_by?: string | null
          opening_igst?: number | null
          opening_override_at?: string | null
          opening_override_by?: string | null
          opening_override_justification?: string | null
          opening_portal_pulled_at?: string | null
          opening_portal_pulled_by?: string | null
          opening_sgst?: number | null
          opening_source?: string
          period_month: string
          updated_at?: string | null
          updated_by?: string | null
          utilized_cgst?: number | null
          utilized_igst?: number | null
          utilized_sgst?: number | null
        }
        Update: {
          books_closing_cgst?: number | null
          books_closing_igst?: number | null
          books_closing_sgst?: number | null
          client_id?: string
          drc_cgst?: number | null
          drc_igst?: number | null
          drc_sgst?: number | null
          id?: string
          opening_cgst?: number | null
          opening_csv_period_month?: string | null
          opening_csv_uploaded_at?: string | null
          opening_csv_uploaded_by?: string | null
          opening_igst?: number | null
          opening_override_at?: string | null
          opening_override_by?: string | null
          opening_override_justification?: string | null
          opening_portal_pulled_at?: string | null
          opening_portal_pulled_by?: string | null
          opening_sgst?: number | null
          opening_source?: string
          period_month?: string
          updated_at?: string | null
          updated_by?: string | null
          utilized_cgst?: number | null
          utilized_igst?: number | null
          utilized_sgst?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gst_receivable_reco_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_refund_applications: {
        Row: {
          arn: string | null
          claimed_amount: number | null
          client_id: string
          created_at: string
          deleted_at: string | null
          documents: Json
          filed_date: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          portal_key: string
          pulled_at: string
          pulled_by: string | null
          refund_type: string | null
          sanctioned_amount: number | null
          source_ledger: string | null
          status: string | null
          updated_at: string
          portal_hash: string | null
        }
        Insert: {
          arn?: string | null
          claimed_amount?: number | null
          client_id: string
          created_at?: string
          deleted_at?: string | null
          documents?: Json
          filed_date?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          portal_key: string
          pulled_at?: string
          pulled_by?: string | null
          refund_type?: string | null
          sanctioned_amount?: number | null
          source_ledger?: string | null
          status?: string | null
          updated_at?: string
          portal_hash?: string | null
        }
        Update: {
          arn?: string | null
          claimed_amount?: number | null
          client_id?: string
          created_at?: string
          deleted_at?: string | null
          documents?: Json
          filed_date?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          portal_key?: string
          pulled_at?: string
          pulled_by?: string | null
          refund_type?: string | null
          sanctioned_amount?: number | null
          source_ledger?: string | null
          status?: string | null
          updated_at?: string
          portal_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gst_refund_applications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_running_updates: {
        Row: {
          cgst: number | null
          client_id: string
          created_at: string | null
          effect_month: string | null
          id: string
          igst: number | null
          instructions_by_employee_id: string | null
          interest: number | null
          itc_section: string | null
          itc_sr_no: string | null
          matter_brief: string | null
          remarks: string | null
          sgst: number | null
          taxable_value: number | null
          update_effect_month: string
          update_in_return: string
          update_instructions_by: string | null
          update_type: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          cgst?: number | null
          client_id: string
          created_at?: string | null
          effect_month?: string | null
          id?: string
          igst?: number | null
          instructions_by_employee_id?: string | null
          interest?: number | null
          itc_section?: string | null
          itc_sr_no?: string | null
          matter_brief?: string | null
          remarks?: string | null
          sgst?: number | null
          taxable_value?: number | null
          update_effect_month: string
          update_in_return: string
          update_instructions_by?: string | null
          update_type: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          cgst?: number | null
          client_id?: string
          created_at?: string | null
          effect_month?: string | null
          id?: string
          igst?: number | null
          instructions_by_employee_id?: string | null
          interest?: number | null
          itc_section?: string | null
          itc_sr_no?: string | null
          matter_brief?: string | null
          remarks?: string | null
          sgst?: number | null
          taxable_value?: number | null
          update_effect_month?: string
          update_in_return?: string
          update_instructions_by?: string | null
          update_type?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gst_running_updates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_taxpayer_profile: {
        Row: {
          aadhaar_authentication_status: string | null
          client_id: string
          constitution_of_business: string | null
          created_at: string
          id: string
          jurisdiction_centre: string | null
          jurisdiction_state: string | null
          legal_name: string | null
          principal_place_address: string | null
          pulled_at: string
          pulled_by: string | null
          registration_certificate_url: string | null
          registration_date: string | null
          trade_name: string | null
          updated_at: string
          gstin_status: string | null
          cancellation_date: string | null
          profile_json: Json | null
        }
        Insert: {
          aadhaar_authentication_status?: string | null
          client_id: string
          constitution_of_business?: string | null
          created_at?: string
          id?: string
          jurisdiction_centre?: string | null
          jurisdiction_state?: string | null
          legal_name?: string | null
          principal_place_address?: string | null
          pulled_at?: string
          pulled_by?: string | null
          registration_certificate_url?: string | null
          registration_date?: string | null
          trade_name?: string | null
          updated_at?: string
          gstin_status?: string | null
          cancellation_date?: string | null
          profile_json?: Json | null
        }
        Update: {
          aadhaar_authentication_status?: string | null
          client_id?: string
          constitution_of_business?: string | null
          created_at?: string
          id?: string
          jurisdiction_centre?: string | null
          jurisdiction_state?: string | null
          legal_name?: string | null
          principal_place_address?: string | null
          pulled_at?: string
          pulled_by?: string | null
          registration_certificate_url?: string | null
          registration_date?: string | null
          trade_name?: string | null
          updated_at?: string
          gstin_status?: string | null
          cancellation_date?: string | null
          profile_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "gst_taxpayer_profile_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_update_row_versions: {
        Row: {
          changed_at: string
          changed_by_employee_id: string | null
          field_name: string
          group_version_id: string | null
          id: string
          new_value: Json | null
          old_value: Json | null
          row_id: string
        }
        Insert: {
          changed_at?: string
          changed_by_employee_id?: string | null
          field_name: string
          group_version_id?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          row_id: string
        }
        Update: {
          changed_at?: string
          changed_by_employee_id?: string | null
          field_name?: string
          group_version_id?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          row_id?: string
        }
        Relationships: []
      }
      gst_update_versions: {
        Row: {
          action_type: string | null
          client_id: string | null
          filter_context: Json | null
          id: string
          is_current: boolean | null
          restored_from_version_id: string | null
          updated_at: string | null
          updated_by: string | null
          version_data: Json | null
          version_number: number | null
        }
        Insert: {
          action_type?: string | null
          client_id?: string | null
          filter_context?: Json | null
          id?: string
          is_current?: boolean | null
          restored_from_version_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version_data?: Json | null
          version_number?: number | null
        }
        Update: {
          action_type?: string | null
          client_id?: string | null
          filter_context?: Json | null
          id?: string
          is_current?: boolean | null
          restored_from_version_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version_data?: Json | null
          version_number?: number | null
        }
        Relationships: []
      }
      gstr1_data: {
        Row: {
          client_id: string
          file_name: string | null
          id: string
          imported_at: string
          imported_by: string | null
          last_push_by: string | null
          last_push_message: string | null
          last_push_status: string | null
          last_pushed_at: string | null
          last_upload_errors: Json | null
          last_upload_status: string | null
          last_upload_summary: string | null
          last_uploaded_at: string | null
          last_uploaded_by: string | null
          period_month: string
          raw_json: Json
          updated_at: string | null
        }
        Insert: {
          client_id: string
          file_name?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          last_push_by?: string | null
          last_push_message?: string | null
          last_push_status?: string | null
          last_pushed_at?: string | null
          last_upload_errors?: Json | null
          last_upload_status?: string | null
          last_upload_summary?: string | null
          last_uploaded_at?: string | null
          last_uploaded_by?: string | null
          period_month: string
          raw_json?: Json
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          file_name?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          last_push_by?: string | null
          last_push_message?: string | null
          last_push_status?: string | null
          last_pushed_at?: string | null
          last_upload_errors?: Json | null
          last_upload_status?: string | null
          last_upload_summary?: string | null
          last_uploaded_at?: string | null
          last_uploaded_by?: string | null
          period_month?: string
          raw_json?: Json
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gstr1_data_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr1_manual_entries: {
        Row: {
          client_id: string
          data: Json
          id: string
          period_month: string
          row_order: number
          section: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          data?: Json
          id?: string
          period_month: string
          row_order?: number
          section: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          data?: Json
          id?: string
          period_month?: string
          row_order?: number
          section?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gstr1_manual_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr1_upload_versions: {
        Row: {
          action_at: string
          action_type: string
          actor_id: string | null
          client_id: string
          errors: Json | null
          file_name: string | null
          id: string
          period_month: string
          payload: Json | null
          status: string | null
          summary: string | null
          version_number: number
        }
        Insert: {
          action_at?: string
          action_type: string
          actor_id?: string | null
          client_id: string
          errors?: Json | null
          file_name?: string | null
          id?: string
          period_month: string
          payload: Json | null
          status?: string | null
          summary?: string | null
          version_number: number
        }
        Update: {
          action_at?: string
          action_type?: string
          actor_id?: string | null
          client_id?: string
          errors?: Json | null
          file_name?: string | null
          id?: string
          period_month?: string
          payload?: Json | null
          status?: string | null
          summary?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "gstr1_upload_versions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr1_upload_versions_quarantine: {
        Row: {
          action_at: string
          action_type: string
          actor_id: string | null
          client_id: string
          errors: Json | null
          file_name: string | null
          id: string
          payload: Json | null
          period_month: string
          quarantined_at: string | null
          quarantined_reason: string | null
          status: string | null
          summary: string | null
          version_number: number
        }
        Insert: {
          action_at?: string
          action_type: string
          actor_id?: string | null
          client_id: string
          errors?: Json | null
          file_name?: string | null
          id?: string
          payload?: Json | null
          period_month: string
          quarantined_at?: string | null
          quarantined_reason?: string | null
          status?: string | null
          summary?: string | null
          version_number: number
        }
        Update: {
          action_at?: string
          action_type?: string
          actor_id?: string | null
          client_id?: string
          errors?: Json | null
          file_name?: string | null
          id?: string
          payload?: Json | null
          period_month?: string
          quarantined_at?: string | null
          quarantined_reason?: string | null
          status?: string | null
          summary?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "gstr1_upload_versions_quarantine_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr2a_import_docs: {
        Row: {
          bucket: string
          cess: number | null
          client_id: string
          date: string | null
          gstr1_filing_date: string | null
          gstr1_period: string | null
          id: string
          import_batch_id: string | null
          imported_at: string
          imported_by: string | null
          input_cgst: number | null
          input_igst: number | null
          input_sgst: number | null
          invoice_type: string | null
          invoice_value: number | null
          irn: string | null
          period_month: string
          place_of_supply: string | null
          reverse_charge: boolean
          source: string | null
          supplier_gstin: string | null
          supplier_invoice_number: string | null
          supplier_name: string | null
          taxable_value: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bucket?: string
          cess?: number | null
          client_id: string
          date?: string | null
          gstr1_filing_date?: string | null
          gstr1_period?: string | null
          id?: string
          import_batch_id?: string | null
          imported_at?: string
          imported_by?: string | null
          input_cgst?: number | null
          input_igst?: number | null
          input_sgst?: number | null
          invoice_type?: string | null
          invoice_value?: number | null
          irn?: string | null
          period_month: string
          place_of_supply?: string | null
          reverse_charge?: boolean
          source?: string | null
          supplier_gstin?: string | null
          supplier_invoice_number?: string | null
          supplier_name?: string | null
          taxable_value?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bucket?: string
          cess?: number | null
          client_id?: string
          date?: string | null
          gstr1_filing_date?: string | null
          gstr1_period?: string | null
          id?: string
          import_batch_id?: string | null
          imported_at?: string
          imported_by?: string | null
          input_cgst?: number | null
          input_igst?: number | null
          input_sgst?: number | null
          invoice_type?: string | null
          invoice_value?: number | null
          irn?: string | null
          period_month?: string
          place_of_supply?: string | null
          reverse_charge?: boolean
          source?: string | null
          supplier_gstin?: string | null
          supplier_invoice_number?: string | null
          supplier_name?: string | null
          taxable_value?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gstr2a_import_docs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr3b_adjustments: {
        Row: {
          cess: number
          cgst: number
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          igst: number
          label: string
          period_month: string
          reason: string
          sgst: number
          source: string
          table_ref: string
          taxable_value: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cess?: number
          cgst?: number
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          igst?: number
          label: string
          period_month: string
          reason: string
          sgst?: number
          source?: string
          table_ref: string
          taxable_value?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cess?: number
          cgst?: number
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          igst?: number
          label?: string
          period_month?: string
          reason?: string
          sgst?: number
          source?: string
          table_ref?: string
          taxable_value?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gstr3b_adjustments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr3b_push_versions: {
        Row: {
          action_at: string
          actor_id: string | null
          client_id: string
          filled_count: number | null
          id: string
          period_month: string
          payload: Json | null
          skipped: Json | null
          status: string | null
          summary: string | null
          version_number: number
        }
        Insert: {
          action_at?: string
          actor_id?: string | null
          client_id: string
          filled_count?: number | null
          id?: string
          period_month: string
          payload: Json | null
          skipped?: Json | null
          status?: string | null
          summary?: string | null
          version_number: number
        }
        Update: {
          action_at?: string
          actor_id?: string | null
          client_id?: string
          filled_count?: number | null
          id?: string
          period_month?: string
          payload?: Json | null
          skipped?: Json | null
          status?: string | null
          summary?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "gstr3b_push_versions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr9_output_lines: {
        Row: {
          category: string
          cgst: number
          client_id: string
          created_at: string
          entered_by: string | null
          financial_year: string
          id: string
          igst: number
          sgst: number
          taxable_value: number
          updated_at: string
        }
        Insert: {
          category: string
          cgst?: number
          client_id: string
          created_at?: string
          entered_by?: string | null
          financial_year: string
          id?: string
          igst?: number
          sgst?: number
          taxable_value?: number
          updated_at?: string
        }
        Update: {
          category?: string
          cgst?: number
          client_id?: string
          created_at?: string
          entered_by?: string | null
          financial_year?: string
          id?: string
          igst?: number
          sgst?: number
          taxable_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gstr9_output_lines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr9_table14_differential_tax: {
        Row: {
          client_id: string
          entered_by: string | null
          financial_year: string
          id: string
          paid: number
          payable: number
          tax_head: string
          updated_at: string
        }
        Insert: {
          client_id: string
          entered_by?: string | null
          financial_year: string
          id?: string
          paid?: number
          payable?: number
          tax_head: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          entered_by?: string | null
          financial_year?: string
          id?: string
          paid?: number
          payable?: number
          tax_head?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gstr9_table14_differential_tax_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr9_table15_demands_refunds: {
        Row: {
          central_tax: number
          cess: number
          client_id: string
          entered_by: string | null
          financial_year: string
          id: string
          integrated_tax: number
          interest: number
          penalty: number
          row_key: string
          state_tax: number
          updated_at: string
        }
        Insert: {
          central_tax?: number
          cess?: number
          client_id: string
          entered_by?: string | null
          financial_year: string
          id?: string
          integrated_tax?: number
          interest?: number
          penalty?: number
          row_key: string
          state_tax?: number
          updated_at?: string
        }
        Update: {
          central_tax?: number
          cess?: number
          client_id?: string
          entered_by?: string | null
          financial_year?: string
          id?: string
          integrated_tax?: number
          interest?: number
          penalty?: number
          row_key?: string
          state_tax?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gstr9_table15_demands_refunds_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr9_table16_composition_deemed_approval: {
        Row: {
          central_tax: number
          cess: number
          client_id: string
          entered_by: string | null
          financial_year: string
          id: string
          integrated_tax: number
          row_key: string
          state_tax: number
          taxable_value: number
          updated_at: string
        }
        Insert: {
          central_tax?: number
          cess?: number
          client_id: string
          entered_by?: string | null
          financial_year: string
          id?: string
          integrated_tax?: number
          row_key: string
          state_tax?: number
          taxable_value?: number
          updated_at?: string
        }
        Update: {
          central_tax?: number
          cess?: number
          client_id?: string
          entered_by?: string | null
          financial_year?: string
          id?: string
          integrated_tax?: number
          row_key?: string
          state_tax?: number
          taxable_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gstr9_table16_composition_deemed_approval_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr9c_table12_net_itc: {
        Row: {
          client_id: string
          entered_by: string | null
          financial_year: string
          id: string
          itc_earlier_fy_claimed_this_fy: number
          itc_per_financials: number
          itc_this_fy_claimed_later_fy: number
          updated_at: string
        }
        Insert: {
          client_id: string
          entered_by?: string | null
          financial_year: string
          id?: string
          itc_earlier_fy_claimed_this_fy?: number
          itc_per_financials?: number
          itc_this_fy_claimed_later_fy?: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          entered_by?: string | null
          financial_year?: string
          id?: string
          itc_earlier_fy_claimed_this_fy?: number
          itc_per_financials?: number
          itc_this_fy_claimed_later_fy?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gstr9c_table12_net_itc_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr9c_table5_turnover_reco: {
        Row: {
          amount: number
          client_id: string
          entered_by: string | null
          financial_year: string
          id: string
          row_key: string
          updated_at: string
        }
        Insert: {
          amount?: number
          client_id: string
          entered_by?: string | null
          financial_year: string
          id?: string
          row_key: string
          updated_at?: string
        }
        Update: {
          amount?: number
          client_id?: string
          entered_by?: string | null
          financial_year?: string
          id?: string
          row_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gstr9c_table5_turnover_reco_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr9c_table7_taxable_turnover_reco: {
        Row: {
          amount: number
          client_id: string
          entered_by: string | null
          financial_year: string
          id: string
          row_key: string
          updated_at: string
        }
        Insert: {
          amount?: number
          client_id: string
          entered_by?: string | null
          financial_year: string
          id?: string
          row_key: string
          updated_at?: string
        }
        Update: {
          amount?: number
          client_id?: string
          entered_by?: string | null
          financial_year?: string
          id?: string
          row_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gstr9c_table7_taxable_turnover_reco_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      itc_reversal_lines: {
        Row: {
          cgst: number
          client_id: string
          created_at: string
          entered_by: string | null
          financial_year: string
          id: string
          igst: number
          notes: string | null
          rule: string
          sgst: number
          updated_at: string
        }
        Insert: {
          cgst?: number
          client_id: string
          created_at?: string
          entered_by?: string | null
          financial_year: string
          id?: string
          igst?: number
          notes?: string | null
          rule: string
          sgst?: number
          updated_at?: string
        }
        Update: {
          cgst?: number
          client_id?: string
          created_at?: string
          entered_by?: string | null
          financial_year?: string
          id?: string
          igst?: number
          notes?: string | null
          rule?: string
          sgst?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "itc_reversal_lines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      itc_summaries: {
        Row: {
          client_id: string
          data: Json
          edit_history: Json | null
          id: string
          is_locked: boolean | null
          period_month: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          client_id: string
          data?: Json
          edit_history?: Json | null
          id?: string
          is_locked?: boolean | null
          period_month: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          data?: Json
          edit_history?: Json | null
          id?: string
          is_locked?: boolean | null
          period_month?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itc_summaries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      itc_versions: {
        Row: {
          action_type: string | null
          client_id: string
          id: string
          is_current: boolean | null
          period_month: string
          restored_from_version_id: string | null
          updated_at: string | null
          updated_by: string | null
          version_data: Json | null
          version_number: number | null
        }
        Insert: {
          action_type?: string | null
          client_id: string
          id?: string
          is_current?: boolean | null
          period_month: string
          restored_from_version_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version_data?: Json | null
          version_number?: number | null
        }
        Update: {
          action_type?: string | null
          client_id?: string
          id?: string
          is_current?: boolean | null
          period_month?: string
          restored_from_version_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version_data?: Json | null
          version_number?: number | null
        }
        Relationships: []
      }
      Notices: {
        Row: {
          created_at: string
          id: number
        }
        Insert: {
          created_at?: string
          id?: number
        }
        Update: {
          created_at?: string
          id?: number
        }
        Relationships: []
      }
      matter_deadlines: {
        Row: {
          id: string
          notice_id: string
          client_id: string
          deadline_type: string
          deadline_date: string
          statutory_basis: string | null
          source: string
          is_met: boolean
          met_at: string | null
          met_by: string | null
          notes: string | null
          created_at: string
          updated_at: string
          computed_date: string | null
          base_date: string | null
          period_key: string | null
          period_confirmed: boolean
        }
        Insert: {
          id?: string
          notice_id: string
          client_id: string
          deadline_type: string
          deadline_date: string
          statutory_basis?: string | null
          source?: string
          is_met?: boolean
          met_at?: string | null
          met_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
          computed_date?: string | null
          base_date?: string | null
          period_key?: string | null
          period_confirmed?: boolean
        }
        Update: {
          id?: string
          notice_id?: string
          client_id?: string
          deadline_type?: string
          deadline_date?: string
          statutory_basis?: string | null
          source?: string
          is_met?: boolean
          met_at?: string | null
          met_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
          computed_date?: string | null
          base_date?: string | null
          period_key?: string | null
          period_confirmed?: boolean
        }
        Relationships: []
      }
      litigation_matters: {
        Row: {
          id: string
          client_id: string
          matter_no: string
          lifecycle: string
          title: string | null
          section_of_law: string | null
          financial_years: string[] | null
          authority: string | null
          officer: string | null
          jurisdiction: string | null
          stage: string
          status: string
          priority: string | null
          owner_user_id: string | null
          reviewer_user_id: string | null
          demand_tax: number
          demand_interest: number
          demand_penalty: number
          demand_cess: number
          paid_total: number
          pre_deposit_total: number
          computed_due_date: string | null
          override_due_date: string | null
          limitation_date: string | null
          hearing_at: string | null
          next_action: string | null
          closed_at: string | null
          closed_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id: string
          matter_no: string
          lifecycle?: string
          title?: string | null
          section_of_law?: string | null
          financial_years?: string[] | null
          authority?: string | null
          officer?: string | null
          jurisdiction?: string | null
          stage?: string
          status?: string
          priority?: string | null
          owner_user_id?: string | null
          reviewer_user_id?: string | null
          demand_tax?: number
          demand_interest?: number
          demand_penalty?: number
          demand_cess?: number
          paid_total?: number
          pre_deposit_total?: number
          computed_due_date?: string | null
          override_due_date?: string | null
          limitation_date?: string | null
          hearing_at?: string | null
          next_action?: string | null
          closed_at?: string | null
          closed_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          client_id?: string
          matter_no?: string
          lifecycle?: string
          title?: string | null
          section_of_law?: string | null
          financial_years?: string[] | null
          authority?: string | null
          officer?: string | null
          jurisdiction?: string | null
          stage?: string
          status?: string
          priority?: string | null
          owner_user_id?: string | null
          reviewer_user_id?: string | null
          demand_tax?: number
          demand_interest?: number
          demand_penalty?: number
          demand_cess?: number
          paid_total?: number
          pre_deposit_total?: number
          computed_due_date?: string | null
          override_due_date?: string | null
          limitation_date?: string | null
          hearing_at?: string | null
          next_action?: string | null
          closed_at?: string | null
          closed_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      matter_stage_history: {
        Row: {
          id: string
          matter_id: string
          from_stage: string | null
          to_stage: string
          changed_by: string | null
          changed_at: string
          note: string | null
        }
        Insert: {
          id?: string
          matter_id: string
          from_stage?: string | null
          to_stage: string
          changed_by?: string | null
          changed_at?: string
          note?: string | null
        }
        Update: {
          id?: string
          matter_id?: string
          from_stage?: string | null
          to_stage?: string
          changed_by?: string | null
          changed_at?: string
          note?: string | null
        }
        Relationships: []
      }
      matter_events: {
        Row: {
          id: string
          matter_id: string
          notice_id: string | null
          event_type: string
          actor_user_id: string | null
          actor_name: string | null
          payload: Record<string, unknown> | null
          created_at: string
        }
        Insert: {
          id?: string
          matter_id: string
          notice_id?: string | null
          event_type: string
          actor_user_id?: string | null
          actor_name?: string | null
          payload?: Record<string, unknown> | null
          created_at?: string
        }
        Update: {
          id?: string
          matter_id?: string
          notice_id?: string | null
          event_type?: string
          actor_user_id?: string | null
          actor_name?: string | null
          payload?: Record<string, unknown> | null
          created_at?: string
        }
        Relationships: []
      }
      matter_documents: {
        Row: {
          id: string
          matter_id: string | null
          notice_id: string | null
          kind: string
          title: string
          storage_path: string | null
          mime: string | null
          size_bytes: number | null
          source: string
          uploaded_by: string | null
          created_at: string
          uploaded_by_name: string | null
        }
        Insert: {
          id?: string
          matter_id: string
          notice_id?: string | null
          kind?: string
          title: string
          storage_path?: string | null
          mime?: string | null
          size_bytes?: number | null
          source?: string
          uploaded_by?: string | null
          created_at?: string
          uploaded_by_name?: string | null
        }
        Update: {
          id?: string
          matter_id?: string
          notice_id?: string | null
          kind?: string
          title?: string
          storage_path?: string | null
          mime?: string | null
          size_bytes?: number | null
          source?: string
          uploaded_by?: string | null
          created_at?: string
          uploaded_by_name?: string | null
        }
        Relationships: []
      }
      matter_hearings: {
        Row: {
          id: string
          matter_id: string
          scheduled_at: string
          mode: string | null
          venue: string | null
          officer: string | null
          attended_by: string[] | null
          outcome: string | null
          adjourned: boolean
          next_date: string | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          matter_id: string
          scheduled_at: string
          mode?: string | null
          venue?: string | null
          officer?: string | null
          attended_by?: string[] | null
          outcome?: string | null
          adjourned?: boolean
          next_date?: string | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          matter_id?: string
          scheduled_at?: string
          mode?: string | null
          venue?: string | null
          officer?: string | null
          attended_by?: string[] | null
          outcome?: string | null
          adjourned?: boolean
          next_date?: string | null
          notes?: string | null
          created_at?: string
        }
        Relationships: []
      }
      matter_payments: {
        Row: {
          id: string
          matter_id: string
          kind: string
          drc03_arn: string | null
          tax: number
          interest: number
          penalty: number
          cess: number
          paid_on: string | null
          remarks: string | null
          created_at: string
        }
        Insert: {
          id?: string
          matter_id: string
          kind?: string
          drc03_arn?: string | null
          tax?: number
          interest?: number
          penalty?: number
          cess?: number
          paid_on?: string | null
          remarks?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          matter_id?: string
          kind?: string
          drc03_arn?: string | null
          tax?: number
          interest?: number
          penalty?: number
          cess?: number
          paid_on?: string | null
          remarks?: string | null
          created_at?: string
        }
        Relationships: []
      }
      litigation_rules: {
        Row: {
          key: string
          value: number
          unit: string
          effective_from: string | null
          note: string | null
          created_at: string
          confirmed_at: string | null
          confirmed_by: string | null
        }
        Insert: {
          key: string
          value: number
          unit?: string
          effective_from?: string | null
          note?: string | null
          created_at?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
        }
        Update: {
          key?: string
          value?: number
          unit?: string
          effective_from?: string | null
          note?: string | null
          created_at?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
        }
        Relationships: []
      }
      notice_alert_log: {
        Row: {
          id: string
          rule_id: string | null
          notice_id: string | null
          client_id: string | null
          event_id: string | null
          email_outbox_id: string | null
          recipient_email: string | null
          status: string
          suppress_reason: string | null
          dedupe_key: string | null
          created_at: string
        }
        Insert: {
          id?: string
          rule_id?: string | null
          notice_id?: string | null
          client_id?: string | null
          event_id?: string | null
          email_outbox_id?: string | null
          recipient_email?: string | null
          status?: string
          suppress_reason?: string | null
          dedupe_key?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          rule_id?: string | null
          notice_id?: string | null
          client_id?: string | null
          event_id?: string | null
          email_outbox_id?: string | null
          recipient_email?: string | null
          status?: string
          suppress_reason?: string | null
          dedupe_key?: string | null
          created_at?: string
        }
        Relationships: []
      }
      notice_alert_rules: {
        Row: {
          id: string
          alert_key: string
          name: string
          description: string | null
          event_type: string | null
          schedule: string | null
          template_key: string
          recipient: string
          is_active: boolean
          priority: string
          quiet_hours: boolean
          max_repeats: number | null
          cooldown_hrs: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          alert_key: string
          name: string
          description?: string | null
          event_type?: string | null
          schedule?: string | null
          template_key: string
          recipient?: string
          is_active?: boolean
          priority?: string
          quiet_hours?: boolean
          max_repeats?: number | null
          cooldown_hrs?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          alert_key?: string
          name?: string
          description?: string | null
          event_type?: string | null
          schedule?: string | null
          template_key?: string
          recipient?: string
          is_active?: boolean
          priority?: string
          quiet_hours?: boolean
          max_repeats?: number | null
          cooldown_hrs?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      notice_events: {
        Row: {
          id: string
          notice_id: string
          client_id: string
          event_type: string
          old_value: Json | null
          new_value: Json | null
          actor_id: string | null
          actor_name: string | null
          created_at: string
          source: string | null
          alert_processed_at: string | null
        }
        Insert: {
          id?: string
          notice_id: string
          client_id: string
          event_type: string
          old_value?: Json | null
          new_value?: Json | null
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          source?: string | null
          alert_processed_at?: string | null
        }
        Update: {
          id?: string
          notice_id?: string
          client_id?: string
          event_type?: string
          old_value?: Json | null
          new_value?: Json | null
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          source?: string | null
          alert_processed_at?: string | null
        }
        Relationships: []
      }
      notice_extractions: {
        Row: {
          agent_id: string | null
          attempts: number
          checks: Json | null
          claimed_at: string | null
          client_id: string
          created_at: string
          detail: Json | null
          document_label: string | null
          document_sha256: string | null
          document_url: string | null
          error: string | null
          fields: Json | null
          finished_at: string | null
          id: string
          issues: Json | null
          model: string | null
          not_before: string | null
          notice_id: string
          outcome: string | null
          pages: number | null
          priority: number
          reason_class: string | null
          requested_by: string | null
          requested_by_name: string | null
          source: string
          status: string
          text_layer: boolean | null
          updated_at: string
          usage: Json | null
        }
        Insert: {
          agent_id?: string | null
          attempts?: number
          checks?: Json | null
          claimed_at?: string | null
          client_id: string
          created_at?: string
          detail?: Json | null
          document_label?: string | null
          document_sha256?: string | null
          document_url?: string | null
          error?: string | null
          fields?: Json | null
          finished_at?: string | null
          id?: string
          issues?: Json | null
          model?: string | null
          not_before?: string | null
          notice_id: string
          outcome?: string | null
          pages?: number | null
          priority?: number
          reason_class?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          source: string
          status?: string
          text_layer?: boolean | null
          updated_at?: string
          usage?: Json | null
        }
        Update: {
          agent_id?: string | null
          attempts?: number
          checks?: Json | null
          claimed_at?: string | null
          client_id?: string
          created_at?: string
          detail?: Json | null
          document_label?: string | null
          document_sha256?: string | null
          document_url?: string | null
          error?: string | null
          fields?: Json | null
          finished_at?: string | null
          id?: string
          issues?: Json | null
          model?: string | null
          not_before?: string | null
          notice_id?: string
          outcome?: string | null
          pages?: number | null
          priority?: number
          reason_class?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          source?: string
          status?: string
          text_layer?: boolean | null
          updated_at?: string
          usage?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "notice_extractions_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "gst_notices"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_reply_options: {
        Row: {
          body: string
          id: string
          inputs: Json
          inputs_hash: string
          notice_id: string
          rendered_at: string
          sort: number
          stance: string
          status: string
          summary: string
          template_key: string
          template_version: number
          title: string
          used_at: string | null
          used_by_name: string | null
          used_draft_id: string | null
        }
        Insert: {
          body: string
          id?: string
          inputs?: Json
          inputs_hash: string
          notice_id: string
          rendered_at?: string
          sort?: number
          stance: string
          status?: string
          summary?: string
          template_key: string
          template_version: number
          title: string
          used_at?: string | null
          used_by_name?: string | null
          used_draft_id?: string | null
        }
        Update: {
          body?: string
          id?: string
          inputs?: Json
          inputs_hash?: string
          notice_id?: string
          rendered_at?: string
          sort?: number
          stance?: string
          status?: string
          summary?: string
          template_key?: string
          template_version?: number
          title?: string
          used_at?: string | null
          used_by_name?: string | null
          used_draft_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notice_reply_options_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "gst_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_reply_options_template_key_fkey"
            columns: ["template_key"]
            isOneToOne: false
            referencedRelation: "reply_templates"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "notice_reply_options_used_draft_id_fkey"
            columns: ["used_draft_id"]
            isOneToOne: false
            referencedRelation: "notice_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_type_settings: {
        Row: {
          form_code: string
          hidden: boolean
          response_need: string
          show_on_dashboard: boolean
          updated_at: string
          updated_by_name: string | null
        }
        Insert: {
          form_code: string
          hidden?: boolean
          response_need?: string
          show_on_dashboard?: boolean
          updated_at?: string
          updated_by_name?: string | null
        }
        Update: {
          form_code?: string
          hidden?: boolean
          response_need?: string
          show_on_dashboard?: boolean
          updated_at?: string
          updated_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notice_type_settings_form_code_fkey"
            columns: ["form_code"]
            isOneToOne: false
            referencedRelation: "notice_form_rules"
            referencedColumns: ["form_code"]
          },
        ]
      }
      password_reset_requests: {
        Row: {
          id: string
          requested_at: string
          requested_by_name: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          id?: string
          requested_at?: string
          requested_by_name: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          id?: string
          requested_at?: string
          requested_by_name?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      pl_input_lines: {
        Row: {
          cgst: number
          client_id: string
          created_at: string
          entered_by: string | null
          expense_head: string | null
          financial_year: string
          id: string
          igst: number
          ledger_head: string
          notes: string | null
          rate: string | null
          section: string
          sgst: number
          sr_no: number | null
          taxable_value: number
          updated_at: string
        }
        Insert: {
          cgst?: number
          client_id: string
          created_at?: string
          entered_by?: string | null
          expense_head?: string | null
          financial_year: string
          id?: string
          igst?: number
          ledger_head: string
          notes?: string | null
          rate?: string | null
          section: string
          sgst?: number
          sr_no?: number | null
          taxable_value?: number
          updated_at?: string
        }
        Update: {
          cgst?: number
          client_id?: string
          created_at?: string
          entered_by?: string | null
          expense_head?: string | null
          financial_year?: string
          id?: string
          igst?: number
          ledger_head?: string
          notes?: string | null
          rate?: string | null
          section?: string
          sgst?: number
          sr_no?: number | null
          taxable_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pl_input_lines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      pl_output_lines: {
        Row: {
          bifurcation: string | null
          cgst: number
          client_id: string
          created_at: string
          entered_by: string | null
          financial_year: string
          id: string
          igst: number
          ledger_head: string
          notes: string | null
          part: string
          rate: string | null
          sgst: number
          sr_no: number | null
          taxable_value: number
          updated_at: string
        }
        Insert: {
          bifurcation?: string | null
          cgst?: number
          client_id: string
          created_at?: string
          entered_by?: string | null
          financial_year: string
          id?: string
          igst?: number
          ledger_head: string
          notes?: string | null
          part: string
          rate?: string | null
          sgst?: number
          sr_no?: number | null
          taxable_value?: number
          updated_at?: string
        }
        Update: {
          bifurcation?: string | null
          cgst?: number
          client_id?: string
          created_at?: string
          entered_by?: string | null
          financial_year?: string
          id?: string
          igst?: number
          ledger_head?: string
          notes?: string | null
          part?: string
          rate?: string | null
          sgst?: number
          sr_no?: number | null
          taxable_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pl_output_lines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_agent_heartbeat: {
        Row: {
          agent_id: string
          info: Json | null
          last_seen: string
        }
        Insert: {
          agent_id: string
          info?: Json | null
          last_seen?: string
        }
        Update: {
          agent_id?: string
          info?: Json | null
          last_seen?: string
        }
        Relationships: []
      }
      portal_emails: {
        Row: {
          client_id: string | null
          created_at: string
          form_code: string | null
          from_addr: string | null
          gstins: string[]
          id: string
          job_id: string | null
          message_id: string
          notice_id: string | null
          notice_seen_at: string | null
          received_at: string
          reference_number: string | null
          snippet: string | null
          status: string
          subject: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          form_code?: string | null
          from_addr?: string | null
          gstins?: string[]
          id?: string
          job_id?: string | null
          message_id: string
          notice_id?: string | null
          notice_seen_at?: string | null
          received_at: string
          reference_number?: string | null
          snippet?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          form_code?: string | null
          from_addr?: string | null
          gstins?: string[]
          id?: string
          job_id?: string | null
          message_id?: string
          notice_id?: string | null
          notice_seen_at?: string | null
          received_at?: string
          reference_number?: string | null
          snippet?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_emails_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_emails_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "portal_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_emails_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "gst_notices"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_gstr1_category_figures: {
        Row: {
          category: string
          cgst: number
          client_id: string
          financial_year: string
          id: string
          igst: number
          sgst: number
          source: string
          taxable_value: number
          updated_at: string
        }
        Insert: {
          category: string
          cgst?: number
          client_id: string
          financial_year: string
          id?: string
          igst?: number
          sgst?: number
          source?: string
          taxable_value?: number
          updated_at?: string
        }
        Update: {
          category?: string
          cgst?: number
          client_id?: string
          financial_year?: string
          id?: string
          igst?: number
          sgst?: number
          source?: string
          taxable_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_gstr1_category_figures_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_job_events: {
        Row: {
          created_at: string | null
          id: string
          job_id: string
          level: string
          message: string | null
          screenshot_path: string | null
          step: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          job_id: string
          level?: string
          message?: string | null
          screenshot_path?: string | null
          step?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          job_id?: string
          level?: string
          message?: string | null
          screenshot_path?: string | null
          step?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "portal_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_jobs: {
        Row: {
          active_key: string | null
          answered_by_name: string | null
          attempts: number
          captcha_answered_at: string | null
          captcha_count: number
          captcha_shown_at: string | null
          captcha_typing_ms: number
          captcha_wait_secs: number
          claimed_by: string | null
          client_id: string
          created_at: string | null
          error: string | null
          finished_at: string | null
          human_prompt: Json | null
          human_response: Json | null
          id: string
          job_type: string
          mode: string
          not_before: string | null
          origin: string | null
          payload: Json | null
          period_month: string | null
          priority: number
          prompt_id: string | null
          queue_rank: number | null
          reason_class: string | null
          requested_by: string | null
          requested_by_name: string | null
          result: Json | null
          run_id: string | null
          session_reused: boolean | null
          started_at: string | null
          status: string
          updated_at: string | null
          verified: boolean | null
        }
        Insert: {
          active_key?: string | null
          answered_by_name?: string | null
          attempts?: number
          captcha_answered_at?: string | null
          captcha_count?: number
          captcha_shown_at?: string | null
          captcha_typing_ms?: number
          captcha_wait_secs?: number
          claimed_by?: string | null
          client_id: string
          created_at?: string | null
          error?: string | null
          finished_at?: string | null
          human_prompt?: Json | null
          human_response?: Json | null
          id?: string
          job_type: string
          mode?: string
          not_before?: string | null
          origin?: string | null
          payload?: Json | null
          period_month?: string | null
          priority?: number
          prompt_id?: string | null
          queue_rank?: number | null
          reason_class?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          result?: Json | null
          run_id?: string | null
          session_reused?: boolean | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
          verified?: boolean | null
        }
        Update: {
          active_key?: string | null
          answered_by_name?: string | null
          attempts?: number
          captcha_answered_at?: string | null
          captcha_count?: number
          captcha_shown_at?: string | null
          captcha_typing_ms?: number
          captcha_wait_secs?: number
          claimed_by?: string | null
          client_id?: string
          created_at?: string | null
          error?: string | null
          finished_at?: string | null
          human_prompt?: Json | null
          human_response?: Json | null
          id?: string
          job_type?: string
          mode?: string
          not_before?: string | null
          origin?: string | null
          payload?: Json | null
          period_month?: string | null
          priority?: number
          prompt_id?: string | null
          queue_rank?: number | null
          reason_class?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          result?: Json | null
          run_id?: string | null
          session_reused?: boolean | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
          verified?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_jobs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_sessions: {
        Row: {
          client_id: string
          storage_state: Json
          updated_at: string
        }
        Insert: {
          client_id: string
          storage_state: Json
          updated_at?: string
        }
        Update: {
          client_id?: string
          storage_state?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_sessions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_tax_payment_entries: {
        Row: {
          client_id: string
          entered_by: string | null
          financial_year: string
          id: string
          interest: number
          late_fee: number
          paid_cash: number
          paid_itc: number
          payable: number
          penalty: number
          tax_head: string
          updated_at: string
        }
        Insert: {
          client_id: string
          entered_by?: string | null
          financial_year: string
          id?: string
          interest?: number
          late_fee?: number
          paid_cash?: number
          paid_itc?: number
          payable?: number
          penalty?: number
          tax_head: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          entered_by?: string | null
          financial_year?: string
          id?: string
          interest?: number
          late_fee?: number
          paid_cash?: number
          paid_itc?: number
          payable?: number
          penalty?: number
          tax_head?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_tax_payment_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_verifications: {
        Row: {
          actual: Json | null
          check_type: string
          client_id: string | null
          created_at: string | null
          diff: Json | null
          expected: Json | null
          id: string
          job_id: string
          passed: boolean
          period_month: string | null
        }
        Insert: {
          actual?: Json | null
          check_type: string
          client_id?: string | null
          created_at?: string | null
          diff?: Json | null
          expected?: Json | null
          id?: string
          job_id: string
          passed: boolean
          period_month?: string | null
        }
        Update: {
          actual?: Json | null
          check_type?: string
          client_id?: string | null
          created_at?: string | null
          diff?: Json | null
          expected?: Json | null
          id?: string
          job_id?: string
          passed?: boolean
          period_month?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_verifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "portal_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          email: string | null
          first_name: string
          id: string
          password: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          first_name: string
          id?: string
          password?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string | null
          first_name?: string
          id?: string
          password?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      rcm_annual_return_lines: {
        Row: {
          category: string
          cgst: number
          client_id: string
          created_at: string
          entered_by: string | null
          financial_year: string
          id: string
          igst: number
          month: string
          sgst: number
          taxable_value: number
          updated_at: string
        }
        Insert: {
          category: string
          cgst?: number
          client_id: string
          created_at?: string
          entered_by?: string | null
          financial_year: string
          id?: string
          igst?: number
          month: string
          sgst?: number
          taxable_value?: number
          updated_at?: string
        }
        Update: {
          category?: string
          cgst?: number
          client_id?: string
          created_at?: string
          entered_by?: string | null
          financial_year?: string
          id?: string
          igst?: number
          month?: string
          sgst?: number
          taxable_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rcm_annual_return_lines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      rcm_data: {
        Row: {
          cgst_2_5: number | null
          cgst_9: number | null
          client_id: string
          financial_year: string
          id: string
          igst_18: number | null
          igst_5: number | null
          is_locked: boolean | null
          master_id: string | null
          month: string
          particulars: string
          rate: string
          sgst_2_5: number | null
          sgst_9: number | null
          supply_type: string
          taxable_value: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          cgst_2_5?: number | null
          cgst_9?: number | null
          client_id: string
          financial_year: string
          id?: string
          igst_18?: number | null
          igst_5?: number | null
          is_locked?: boolean | null
          master_id?: string | null
          month: string
          particulars: string
          rate: string
          sgst_2_5?: number | null
          sgst_9?: number | null
          supply_type?: string
          taxable_value?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          cgst_2_5?: number | null
          cgst_9?: number | null
          client_id?: string
          financial_year?: string
          id?: string
          igst_18?: number | null
          igst_5?: number | null
          is_locked?: boolean | null
          master_id?: string | null
          month?: string
          particulars?: string
          rate?: string
          sgst_2_5?: number | null
          sgst_9?: number | null
          supply_type?: string
          taxable_value?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rcm_data_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rcm_data_master_id_fkey"
            columns: ["master_id"]
            isOneToOne: false
            referencedRelation: "rcm_masters"
            referencedColumns: ["id"]
          },
        ]
      }
      rcm_masters: {
        Row: {
          created_at: string | null
          expense_name: string
          id: string
          is_active: boolean | null
          rate: string
          supply_type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          expense_name: string
          id?: string
          is_active?: boolean | null
          rate: string
          supply_type?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          expense_name?: string
          id?: string
          is_active?: boolean | null
          rate?: string
          supply_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      rcm_versions: {
        Row: {
          action_type: string | null
          client_id: string
          financial_year: string
          id: string
          is_current: boolean | null
          restored_from_version_id: string | null
          updated_at: string | null
          updated_by: string | null
          version_data: Json | null
          version_number: number | null
        }
        Insert: {
          action_type?: string | null
          client_id: string
          financial_year: string
          id?: string
          is_current?: boolean | null
          restored_from_version_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version_data?: Json | null
          version_number?: number | null
        }
        Update: {
          action_type?: string | null
          client_id?: string
          financial_year?: string
          id?: string
          is_current?: boolean | null
          restored_from_version_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version_data?: Json | null
          version_number?: number | null
        }
        Relationships: []
      }
      reconciliation_reasons: {
        Row: {
          client_id: string
          created_at: string
          entered_by: string | null
          financial_year: string
          id: string
          line_key: string
          reason: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          entered_by?: string | null
          financial_year: string
          id?: string
          line_key: string
          reason: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          entered_by?: string | null
          financial_year?: string
          id?: string
          line_key?: string
          reason?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_reasons_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      reply_annexures: {
        Row: {
          client_id: string
          explained_amount: number | null
          financial_year: string | null
          generated_at: string
          generated_by_name: string | null
          id: string
          inputs_hash: string | null
          is_current: boolean
          issue_id: string | null
          note: string | null
          notice_id: string
          periods: string[]
          readiness: Json | null
          recipe_key: string
          status: string
          summary: Json | null
          tables: Json | null
          title: string | null
          to_pay_amount: number | null
          version: number
        }
        Insert: {
          client_id: string
          explained_amount?: number | null
          financial_year?: string | null
          generated_at?: string
          generated_by_name?: string | null
          id?: string
          inputs_hash?: string | null
          is_current?: boolean
          issue_id?: string | null
          note?: string | null
          notice_id: string
          periods?: string[]
          readiness?: Json | null
          recipe_key: string
          status: string
          summary?: Json | null
          tables?: Json | null
          title?: string | null
          to_pay_amount?: number | null
          version: number
        }
        Update: {
          client_id?: string
          explained_amount?: number | null
          financial_year?: string | null
          generated_at?: string
          generated_by_name?: string | null
          id?: string
          inputs_hash?: string | null
          is_current?: boolean
          issue_id?: string | null
          note?: string | null
          notice_id?: string
          periods?: string[]
          readiness?: Json | null
          recipe_key?: string
          status?: string
          summary?: Json | null
          tables?: Json | null
          title?: string | null
          to_pay_amount?: number | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "reply_annexures_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "notice_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reply_annexures_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "gst_notices"
            referencedColumns: ["id"]
          },
        ]
      }
      reply_issue_types: {
        Row: {
          approved_at: string | null
          approved_by_name: string | null
          code: string
          description: string | null
          documents: string[]
          family: string
          firm_position: string | null
          forms: string[]
          is_active: boolean
          para_accept: string | null
          para_contest: string | null
          position_status: string
          recipe_key: string | null
          sort: number
          title: string
          updated_at: string
          updated_by_name: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by_name?: string | null
          code: string
          description?: string | null
          documents?: string[]
          family: string
          firm_position?: string | null
          forms?: string[]
          is_active?: boolean
          para_accept?: string | null
          para_contest?: string | null
          position_status?: string
          recipe_key?: string | null
          sort?: number
          title: string
          updated_at?: string
          updated_by_name?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by_name?: string | null
          code?: string
          description?: string | null
          documents?: string[]
          family?: string
          firm_position?: string | null
          forms?: string[]
          is_active?: boolean
          para_accept?: string | null
          para_contest?: string | null
          position_status?: string
          recipe_key?: string | null
          sort?: number
          title?: string
          updated_at?: string
          updated_by_name?: string | null
        }
        Relationships: [
        ]
      }
      reply_templates: {
        Row: {
          body: string
          created_at: string
          forms: string[]
          is_active: boolean
          key: string
          sort: number
          stance: string
          summary: string
          title: string
          updated_at: string
          updated_by_name: string | null
          version: number
        }
        Insert: {
          body: string
          created_at?: string
          forms?: string[]
          is_active?: boolean
          key: string
          sort?: number
          stance: string
          summary?: string
          title: string
          updated_at?: string
          updated_by_name?: string | null
          version?: number
        }
        Update: {
          body?: string
          created_at?: string
          forms?: string[]
          is_active?: boolean
          key?: string
          sort?: number
          stance?: string
          summary?: string
          title?: string
          updated_at?: string
          updated_by_name?: string | null
          version?: number
        }
        Relationships: [
        ]
      }
      return_reminder_schedules: {
        Row: {
          due_day: number
          reminder_1_day: number
          reminder_2_day: number
          reminder_final_day: number
          return_type: Database["public"]["Enums"]["return_type"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          due_day: number
          reminder_1_day: number
          reminder_2_day: number
          reminder_final_day: number
          return_type: Database["public"]["Enums"]["return_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          due_day?: number
          reminder_1_day?: number
          reminder_2_day?: number
          reminder_final_day?: number
          return_type?: Database["public"]["Enums"]["return_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      staff_notification_prefs: {
        Row: {
          id: string
          user_id: string
          channel: string
          alert_kind: string
          enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          channel?: string
          alert_kind: string
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          channel?: string
          alert_kind?: string
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      staff_task_reminders: {
        Row: {
          allocated_to: string
          client: string
          created_at: string
          deadline: string | null
          id: string
          is_done: boolean
          received_from: string
          reminder_frequency: string
          sort_order: number
          task: string
          ticket_status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          allocated_to?: string
          client?: string
          created_at?: string
          deadline?: string | null
          id?: string
          is_done?: boolean
          received_from?: string
          reminder_frequency?: string
          sort_order?: number
          task?: string
          ticket_status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          allocated_to?: string
          client?: string
          created_at?: string
          deadline?: string | null
          id?: string
          is_done?: boolean
          received_from?: string
          reminder_frequency?: string
          sort_order?: number
          task?: string
          ticket_status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suspended_reco: {
        Row: {
          client_id: string
          id: string
          opening_cgst: number | null
          opening_csv_period_month: string | null
          opening_csv_uploaded_at: string | null
          opening_csv_uploaded_by: string | null
          opening_igst: number | null
          opening_override_at: string | null
          opening_override_by: string | null
          opening_override_justification: string | null
          opening_portal_pulled_at: string | null
          opening_portal_pulled_by: string | null
          opening_sgst: number | null
          opening_source: string
          period_month: string
          portal_cgst: number | null
          portal_igst: number | null
          portal_sgst: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          client_id: string
          id?: string
          opening_cgst?: number | null
          opening_csv_period_month?: string | null
          opening_csv_uploaded_at?: string | null
          opening_csv_uploaded_by?: string | null
          opening_igst?: number | null
          opening_override_at?: string | null
          opening_override_by?: string | null
          opening_override_justification?: string | null
          opening_portal_pulled_at?: string | null
          opening_portal_pulled_by?: string | null
          opening_sgst?: number | null
          opening_source?: string
          period_month: string
          portal_cgst?: number | null
          portal_igst?: number | null
          portal_sgst?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          id?: string
          opening_cgst?: number | null
          opening_csv_period_month?: string | null
          opening_csv_uploaded_at?: string | null
          opening_csv_uploaded_by?: string | null
          opening_igst?: number | null
          opening_override_at?: string | null
          opening_override_by?: string | null
          opening_override_justification?: string | null
          opening_portal_pulled_at?: string | null
          opening_portal_pulled_by?: string | null
          opening_sgst?: number | null
          opening_source?: string
          period_month?: string
          portal_cgst?: number | null
          portal_igst?: number | null
          portal_sgst?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suspended_reco_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      twob_import_docs: {
        Row: {
          bucket: string
          cess: number | null
          client_id: string
          date: string | null
          gstr1_filing_date: string | null
          gstr1_period: string | null
          id: string
          import_batch_id: string | null
          imported_at: string | null
          imported_by: string | null
          input_cgst: number | null
          input_igst: number | null
          input_sgst: number | null
          invoice_type: string | null
          invoice_value: number | null
          irn: string | null
          itc_action: string
          itc_available: boolean | null
          itc_reason: string | null
          matched_book_id: string | null
          period_month: string
          place_of_supply: string | null
          posted_at: string | null
          posted_by: string | null
          reverse_charge: boolean
          source: string | null
          source_sheet: string | null
          supplier_gstin: string | null
          supplier_invoice_number: string | null
          supplier_name: string | null
          taxable_value: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          bucket?: string
          cess?: number | null
          client_id: string
          date?: string | null
          gstr1_filing_date?: string | null
          gstr1_period?: string | null
          id?: string
          import_batch_id?: string | null
          imported_at?: string | null
          imported_by?: string | null
          input_cgst?: number | null
          input_igst?: number | null
          input_sgst?: number | null
          invoice_type?: string | null
          invoice_value?: number | null
          irn?: string | null
          itc_action?: string
          itc_available?: boolean | null
          itc_reason?: string | null
          matched_book_id?: string | null
          period_month: string
          place_of_supply?: string | null
          posted_at?: string | null
          posted_by?: string | null
          reverse_charge?: boolean
          source?: string | null
          source_sheet?: string | null
          supplier_gstin?: string | null
          supplier_invoice_number?: string | null
          supplier_name?: string | null
          taxable_value?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          bucket?: string
          cess?: number | null
          client_id?: string
          date?: string | null
          gstr1_filing_date?: string | null
          gstr1_period?: string | null
          id?: string
          import_batch_id?: string | null
          imported_at?: string | null
          imported_by?: string | null
          input_cgst?: number | null
          input_igst?: number | null
          input_sgst?: number | null
          invoice_type?: string | null
          invoice_value?: number | null
          irn?: string | null
          itc_action?: string
          itc_available?: boolean | null
          itc_reason?: string | null
          matched_book_id?: string | null
          period_month?: string
          place_of_supply?: string | null
          posted_at?: string | null
          posted_by?: string | null
          reverse_charge?: boolean
          source?: string | null
          source_sheet?: string | null
          supplier_gstin?: string | null
          supplier_invoice_number?: string | null
          supplier_name?: string | null
          taxable_value?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "twob_import_docs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      twob_versions: {
        Row: {
          action_type: string | null
          client_id: string
          id: string
          is_current: boolean | null
          period_month: string
          restored_from_version_id: string | null
          table_type: string
          updated_at: string | null
          updated_by: string | null
          version_data: Json | null
          version_number: number | null
        }
        Insert: {
          action_type?: string | null
          client_id: string
          id?: string
          is_current?: boolean | null
          period_month: string
          restored_from_version_id?: string | null
          table_type: string
          updated_at?: string | null
          updated_by?: string | null
          version_data?: Json | null
          version_number?: number | null
        }
        Update: {
          action_type?: string | null
          client_id?: string
          id?: string
          is_current?: boolean | null
          period_month?: string
          restored_from_version_id?: string | null
          table_type?: string
          updated_at?: string | null
          updated_by?: string | null
          version_data?: Json | null
          version_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "twob_versions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          granted_at: string | null
          granted_by: string | null
          id: string
          permission_key: string
          user_id: string
        }
        Insert: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          permission_key: string
          user_id: string
        }
        Update: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          permission_key?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          is_first_login: boolean | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          is_first_login?: boolean | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          is_first_login?: boolean | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      notice_form_rules: {
        Row: {
          appeal_section: string | null
          category: string | null
          clock_basis: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          default_priority: string | null
          form_code: string
          is_active: boolean
          label: string
          match_order: number
          note: string | null
          pattern: string
          reply_day_kind: string
          reply_days: number | null
          updated_at: string
        }
        Insert: {
          appeal_section?: string | null
          category?: string | null
          clock_basis?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          default_priority?: string | null
          form_code: string
          is_active?: boolean
          label: string
          match_order: number
          note?: string | null
          pattern: string
          reply_day_kind?: string
          reply_days?: number | null
          updated_at?: string
        }
        Update: {
          appeal_section?: string | null
          category?: string | null
          clock_basis?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          default_priority?: string | null
          form_code?: string
          is_active?: boolean
          label?: string
          match_order?: number
          note?: string | null
          pattern?: string
          reply_day_kind?: string
          reply_days?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      notice_settings: {
        Row: {
          alerts_mode: string
          alerts_mode_changed_at: string
          app_base_url: string
          computed_clock_from: string
          id: boolean
          new_notice_max_age_days: number
          quiet_end: string
          quiet_start: string
          reply_place: string | null
          reply_signatory: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          alerts_mode?: string
          alerts_mode_changed_at?: string
          app_base_url?: string
          computed_clock_from?: string
          id?: boolean
          new_notice_max_age_days?: number
          quiet_end?: string
          quiet_start?: string
          reply_place?: string | null
          reply_signatory?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          alerts_mode?: string
          alerts_mode_changed_at?: string
          app_base_url?: string
          computed_clock_from?: string
          id?: boolean
          new_notice_max_age_days?: number
          quiet_end?: string
          quiet_start?: string
          reply_place?: string | null
          reply_signatory?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      sync_runs: {
        Row: {
          clients_done: number
          clients_total: number | null
          ext_version: string | null
          finished_at: string | null
          id: string
          machine: string | null
          mode: string | null
          note: string | null
          started_at: string
          status: string
        }
        Insert: {
          clients_done?: number
          clients_total?: number | null
          ext_version?: string | null
          finished_at?: string | null
          id?: string
          machine?: string | null
          mode?: string | null
          note?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          clients_done?: number
          clients_total?: number | null
          ext_version?: string | null
          finished_at?: string | null
          id?: string
          machine?: string | null
          mode?: string | null
          note?: string | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      sync_run_items: {
        Row: {
          alert_processed_at: string | null
          client_id: string
          created_at: string
          ext_version: string | null
          id: string
          message: string | null
          reason_class: string | null
          rows_changed: number
          rows_held: number
          rows_new: number
          rows_removed: number
          rows_seen: number
          rows_unchanged: number
          run_id: string | null
          scope: string | null
          status: string
          step: string
        }
        Insert: {
          alert_processed_at?: string | null
          client_id: string
          created_at?: string
          ext_version?: string | null
          id?: string
          message?: string | null
          reason_class?: string | null
          rows_changed?: number
          rows_held?: number
          rows_new?: number
          rows_removed?: number
          rows_seen?: number
          rows_unchanged?: number
          run_id?: string | null
          scope?: string | null
          status: string
          step: string
        }
        Update: {
          alert_processed_at?: string | null
          client_id?: string
          created_at?: string
          ext_version?: string | null
          id?: string
          message?: string | null
          reason_class?: string | null
          rows_changed?: number
          rows_held?: number
          rows_new?: number
          rows_removed?: number
          rows_seen?: number
          rows_unchanged?: number
          run_id?: string | null
          scope?: string | null
          status?: string
          step?: string
        }
        Relationships: []
      }
      notice_stages: {
        Row: {
          description: string
          is_closed: boolean
          key: string
          label: string
          ord: number
        }
        Insert: {
          description: string
          is_closed?: boolean
          key: string
          label: string
          ord: number
        }
        Update: {
          description?: string
          is_closed?: boolean
          key?: string
          label?: string
          ord?: number
        }
        Relationships: []
      }
      notice_issues: {
        Row: {
          amount: number
          annexure: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          detail: string | null
          explained_amount: number
          id: string
          notice_id: string
          position: string | null
          seq: number
          source: string
          status: string
          title: string
          updated_at: string
          updated_by_name: string | null
          issue_code: string | null
          period_from: string | null
          period_to: string | null
          demand: Json | null
          page: number | null
          quote: string | null
          verified: boolean
          verified_by_name: string | null
          verified_at: string | null
          extraction_id: string | null
          explained_by: string | null
        }
        Insert: {
          amount?: number
          annexure?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          detail?: string | null
          explained_amount?: number
          id?: string
          notice_id: string
          position?: string | null
          seq?: number
          source?: string
          status?: string
          title: string
          updated_at?: string
          updated_by_name?: string | null
          issue_code?: string | null
          period_from?: string | null
          period_to?: string | null
          demand?: Json | null
          page?: number | null
          quote?: string | null
          verified?: boolean
          verified_by_name?: string | null
          verified_at?: string | null
          extraction_id?: string | null
          explained_by?: string | null
        }
        Update: {
          amount?: number
          annexure?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          detail?: string | null
          explained_amount?: number
          id?: string
          notice_id?: string
          position?: string | null
          seq?: number
          source?: string
          status?: string
          title?: string
          updated_at?: string
          updated_by_name?: string | null
          issue_code?: string | null
          period_from?: string | null
          period_to?: string | null
          demand?: Json | null
          page?: number | null
          quote?: string | null
          verified?: boolean
          verified_by_name?: string | null
          verified_at?: string | null
          extraction_id?: string | null
          explained_by?: string | null
        }
        Relationships: []
      }
      notice_drafts: {
        Row: {
          author_id: string | null
          author_name: string | null
          body: string
          created_at: string
          id: string
          notice_id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          source_option_id: string | null
          source_template_key: string | null
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          author_id?: string | null
          author_name?: string | null
          body?: string
          created_at?: string
          id?: string
          notice_id: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          source_option_id?: string | null
          source_template_key?: string | null
          status?: string
          updated_at?: string
          version: number
        }
        Update: {
          author_id?: string | null
          author_name?: string | null
          body?: string
          created_at?: string
          id?: string
          notice_id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          source_option_id?: string | null
          source_template_key?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      notice_doc_requests: {
        Row: {
          created_at: string
          document_id: string | null
          due_date: string | null
          id: string
          item: string
          last_reminded_at: string | null
          note: string | null
          notice_id: string
          reminders_sent: number
          requested_at: string
          requested_by: string | null
          requested_by_name: string | null
          resolved_at: string | null
          resolved_by_name: string | null
          status: string
          updated_at: string
          issue_id: string | null
          source: string
          client_uploaded_at: string | null
          client_note: string | null
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          due_date?: string | null
          id?: string
          item: string
          last_reminded_at?: string | null
          note?: string | null
          notice_id: string
          reminders_sent?: number
          requested_at?: string
          requested_by?: string | null
          requested_by_name?: string | null
          resolved_at?: string | null
          resolved_by_name?: string | null
          status?: string
          updated_at?: string
          issue_id?: string | null
          source?: string
          client_uploaded_at?: string | null
          client_note?: string | null
        }
        Update: {
          created_at?: string
          document_id?: string | null
          due_date?: string | null
          id?: string
          item?: string
          last_reminded_at?: string | null
          note?: string | null
          notice_id?: string
          reminders_sent?: number
          requested_at?: string
          requested_by?: string | null
          requested_by_name?: string | null
          resolved_at?: string | null
          resolved_by_name?: string | null
          status?: string
          updated_at?: string
          issue_id?: string | null
          source?: string
          client_uploaded_at?: string | null
          client_note?: string | null
        }
        Relationships: []
      }
      notice_payments: {
        Row: {
          amount: number
          created_at: string
          created_by_name: string | null
          drc03_arn: string | null
          id: string
          kind: string
          note: string | null
          notice_id: string
          paid_on: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by_name?: string | null
          drc03_arn?: string | null
          id?: string
          kind?: string
          note?: string | null
          notice_id: string
          paid_on?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by_name?: string | null
          drc03_arn?: string | null
          id?: string
          kind?: string
          note?: string | null
          notice_id?: string
          paid_on?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      ai_learning_responses: {
        Row: {
          case_id: string | null
          client_id: string | null
          client_name: string | null
          financial_year: string | null
          form_code: string | null
          id: string | null
          label: string | null
          learning_decided_at: string | null
          learning_decided_by_name: string | null
          learning_included: boolean | null
          notice_id: string | null
          notice_ref: string | null
          pairs: number | null
          pairs_included: number | null
          phase: string | null
          response_date: string | null
          source: string | null
          status: string | null
          summary: string | null
          title: string | null
          updated_at: string | null
        }
        Relationships: [
        ]
      }
      notice_form_choices: {
        Row: {
          form_code: string | null
          label: string | null
          category: string | null
          default_priority: string | null
          reply_days: number | null
          reply_day_kind: string | null
          clock_basis: string | null
        }
        Relationships: []
      }
      notice_plan: {
        Row: {
          amount_of_demand: number | null
          assign_to: string | null
          assign_to_user_id: string | null
          case_id: string | null
          category: string | null
          client_gstin: string | null
          client_id: string | null
          client_inactive: boolean | null
          client_name: string | null
          clock_date: string | null
          clock_type: string | null
          close_reason: string | null
          created_at: string | null
          days_in_stage: number | null
          days_to_due: number | null
          days_to_plan_due: number | null
          default_priority: string | null
          description: string | null
          dispute_key: string | null
          docs_last_reminded_at: string | null
          docs_open: number | null
          docs_reminders: number | null
          docs_total: number | null
          draft_status: string | null
          draft_version: number | null
          due_basis: string | null
          due_basis_note: string | null
          due_date: string | null
          effective_due: string | null
          effective_priority: string | null
          exposure_amount: number | null
          extended_due_date: string | null
          financial_year: string | null
          first_seen_at: string | null
          form_code: string | null
          form_label: string | null
          hearing_date: string | null
          hearing_note: string | null
          hearing_soon: boolean | null
          id: string | null
          in_plan: boolean | null
          is_drc03_case: boolean | null
          is_due_in_7: boolean | null
          is_new: boolean | null
          is_open: boolean | null
          is_overdue: boolean | null
          is_refund_case: boolean | null
          is_replied: boolean | null
          is_unassigned: boolean | null
          issue_date: string | null
          issued_by: string | null
          issues_amount: number | null
          issues_explained: number | null
          issues_to_pay: number | null
          issues_total: number | null
          last_seen_at: string | null
          matter_id: string | null
          next_action: string | null
          notice_type: string | null
          on_dashboard: boolean | null
          order_date: string | null
          order_number: string | null
          pdf_url: string | null
          plan_due: string | null
          plan_due_kind: string | null
          plan_score: number | null
          portal_key: string | null
          portal_status: string | null
          priority: string | null
          pulled_at: string | null
          readiness: number | null
          readiness_pct: number | null
          reference_number: string | null
          remarks: string | null
          reply_date: string | null
          reply_due: string | null
          reply_ref_number: string | null
          response_need: string | null
          source: string | null
          staff_status: string | null
          stage: string | null
          stage_changed_at: string | null
          stage_changed_by: string | null
          stage_label: string | null
          stage_ord: number | null
          submission_arn: string | null
          submission_date: string | null
          today_ist: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      notice_facts: {
        Row: {
          amount_of_demand: number | null
          assign_to: string | null
          assign_to_user_id: string | null
          case_id: string | null
          category: string | null
          client_gstin: string | null
          client_id: string | null
          client_inactive: boolean | null
          client_name: string | null
          close_reason: string | null
          created_at: string | null
          days_in_stage: number | null
          days_to_due: number | null
          default_priority: string | null
          description: string | null
          dispute_key: string | null
          due_basis: string | null
          due_basis_note: string | null
          due_date: string | null
          effective_due: string | null
          effective_priority: string | null
          exposure_amount: number | null
          extended_due_date: string | null
          financial_year: string | null
          first_seen_at: string | null
          form_code: string | null
          form_label: string | null
          hearing_date: string | null
          hearing_note: string | null
          id: string | null
          is_drc03_case: boolean | null
          is_due_in_7: boolean | null
          is_new: boolean | null
          is_open: boolean | null
          is_overdue: boolean | null
          is_refund_case: boolean | null
          is_replied: boolean | null
          is_unassigned: boolean | null
          issue_date: string | null
          issued_by: string | null
          last_seen_at: string | null
          matter_id: string | null
          notice_type: string | null
          on_dashboard: boolean | null
          order_date: string | null
          order_number: string | null
          pdf_url: string | null
          portal_key: string | null
          portal_status: string | null
          priority: string | null
          pulled_at: string | null
          reference_number: string | null
          remarks: string | null
          reply_date: string | null
          reply_ref_number: string | null
          response_need: string | null
          source: string | null
          staff_status: string | null
          stage: string | null
          stage_changed_at: string | null
          stage_changed_by: string | null
          stage_label: string | null
          stage_ord: number | null
          submission_arn: string | null
          submission_date: string | null
          today_ist: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      notice_cases: {
        Row: {
          client_id: string | null
          client_name: string | null
          client_gstin: string | null
          case_key: string | null
          case_id: string | null
          track: string | null
          title: string | null
          lead_notice_id: string | null
          id: string | null
          form_code: string | null
          form_label: string | null
          category: string | null
          reference_number: string | null
          stage: string | null
          stage_label: string | null
          stage_ord: number | null
          assign_to: string | null
          assign_to_user_id: string | null
          effective_priority: string | null
          financial_year: string | null
          financial_years: string | null
          forms: string[] | null
          notices: number | null
          open_notices: number | null
          is_open: boolean | null
          is_overdue: boolean | null
          is_due_in_7: boolean | null
          is_unassigned: boolean | null
          next_due: string | null
          next_hearing: string | null
          first_issue_date: string | null
          last_issue_date: string | null
          exposure: number | null
          amount_of_demand: number | null
          on_dashboard: boolean | null
          documents: number | null
          new_items: number | null
          new_at: string | null
          last_arrived_at: string | null
          seen_at: string | null
          latest_label: string | null
          latest_kind: string | null
          latest_from: string | null
          latest_date: string | null
          last_activity_date: string | null
          today_ist: string | null
        }
        Relationships: []
      }
      notice_case_correspondence: {
        Row: {
          client_id: string | null
          case_key: string | null
          kind: string | null
          item_id: string | null
          from_party: string | null
          item_date: string | null
          first_seen_at: string | null
          label: string | null
          reference: string | null
          folder_section: string | null
          seen_at: string | null
          is_new: boolean | null
        }
        Relationships: []
      }
      ai_learning_clients: {
        Row: {
          client_id: string | null
          client_name: string | null
          client_gstin: string | null
          ai_learning: boolean | null
          ai_learning_by_name: string | null
          ai_learning_at: string | null
          responses: number | null
          responses_included: number | null
          past: number | null
          ongoing: number | null
          read: number | null
          pairs: number | null
          pairs_included: number | null
          last_response_date: string | null
          forms: string[] | null
          financial_years: string[] | null
        }
        Relationships: []
      }
      notice_type_overview: {
        Row: {
          category: string | null
          form_code: string | null
          hidden: boolean | null
          is_active: boolean | null
          label: string | null
          match_order: number | null
          open_count: number | null
          response_need: string | null
          show_on_dashboard: boolean | null
          total_count: number | null
          updated_at: string | null
          updated_by_name: string | null
        }
        Relationships: []
      }
      refund_facts: {
        Row: {
          arn: string | null
          claimed_amount: number | null
          client_gstin: string | null
          client_id: string | null
          client_name: string | null
          documents: Json | null
          filed_date: string | null
          id: string | null
          is_closed: boolean | null
          notice_id: string | null
          origin: string | null
          refund_type: string | null
          sanctioned_amount: number | null
          status: string | null
        }
        Relationships: []
      }
      drc03_facts: {
        Row: {
          arn: string | null
          cause_of_payment: string | null
          client_gstin: string | null
          client_id: string | null
          client_name: string | null
          filed_date: string | null
          id: string | null
          is_closed: boolean | null
          notice_id: string | null
          origin: string | null
          pdf_url: string | null
          status: string | null
        }
        Relationships: []
      }
      notice_exposure: {
        Row: {
          amount: number | null
          client_id: string | null
          kind: string | null
          ref_id: string | null
        }
        Relationships: []
      }
      client_sync_status: {
        Row: {
          client_id: string | null
          is_stale: boolean | null
          last_attempt_at: string | null
          last_ext_version: string | null
          last_message: string | null
          last_reason_class: string | null
          last_run_id: string | null
          last_status: string | null
          last_success_at: string | null
          rows_changed: number | null
          rows_held: number | null
          rows_new: number | null
          rows_removed: number | null
          rows_seen: number | null
          step: string | null
        }
        Relationships: []
      }
      annual_return_activity: {
        Row: {
          client_id: string | null
          financial_year: string | null
          last_saved_at: string | null
          sheets: number | null
        }
        Relationships: []
      }
      annual_return_signoff_changes: {
        Row: {
          client_id: string | null
          financial_year: string | null
          last_change_at: string | null
          last_change_by: string | null
          since_prepared: number | null
          since_verified: number | null
        }
        Relationships: []
      }
      builder_dastavej_reco: {
        Row: {
          booked_at_cutoff: boolean | null
          bu_date: string | null
          bu_event_id: string | null
          client_id: string | null
          cut_off_source: string | null
          dastavej_date: string | null
          dastavej_value: number | null
          opening_agreement_value: number | null
          project_id: string | null
          project_name: string | null
          unit_id: string | null
          unit_no: string | null
          unit_status: string | null
          unit_type: string | null
          value_taxed: number | null
          variance: number | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_bu_event_units_bu_event_id_fkey"
            columns: ["bu_event_id"]
            isOneToOne: false
            referencedRelation: "builder_bu_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_project_areas"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "builder_units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_rcm_postings"
            referencedColumns: ["project_id"]
          },
        ]
      }
      builder_period_postings: {
        Row: {
          booking_id: string | null
          cgst: number | null
          client_id: string | null
          consideration: number | null
          doc_date: string | null
          doc_no: string | null
          gstr1_table: string | null
          land_deduction: number | null
          original_period: string | null
          period_month: string | null
          project_id: string | null
          rate_code: string | null
          rate_pct: number | null
          sgst: number | null
          source_id: string | null
          source_type: string | null
          taxable_value: number | null
          unit_id: string | null
          unit_no: string | null
        }
        Relationships: []
      }
      builder_project_areas: {
        Row: {
          carpet_area_source: string | null
          client_id: string | null
          commercial_sqm: number | null
          derived_commercial_sqm: number | null
          derived_residential_sqm: number | null
          project_id: string | null
          residential_sqm: number | null
          unit_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_rcm_postings: {
        Row: {
          allocated_value: number | null
          bu_date: string | null
          bu_event_id: string | null
          cgst: number | null
          client_id: string | null
          commercial_rcm: number | null
          gstr3b_table: string | null
          period_month: string | null
          project_id: string | null
          project_name: string | null
          residential_rcm: number | null
          sgst: number | null
          source_id: string | null
          source_type: string | null
          taxable_tax: number | null
          taxable_value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_fsi_workings_bu_event_id_fkey"
            columns: ["bu_event_id"]
            isOneToOne: true
            referencedRelation: "builder_bu_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_unit_ledger: {
        Row: {
          cgst_discharged: number | null
          client_id: string | null
          open_advance: number | null
          opening_agreement_value: number | null
          opening_value_taxed: number | null
          project_id: string | null
          sgst_discharged: number | null
          total_received: number | null
          total_tds_194ia: number | null
          unit_id: string | null
          unit_no: string | null
          value_taxed: number | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_project_areas"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "builder_units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "builder_rcm_postings"
            referencedColumns: ["project_id"]
          },
        ]
      }
    }
    Functions: {
      notice_case_items: {
        Args: { p_client_id: string; p_case_key: string }
        Returns: Json
      }
      notice_case_overview: {
        Args: { p_client_id: string; p_case_key: string; p_notice_id?: string | null }
        Returns: Json
      }
      notice_cases_counts: {
        Args: { p_filters?: Json | null }
        Returns: Json
      }
      notice_case_mark_seen: {
        Args: { p_client_id: string; p_case_key: string; p_by_name?: string | null }
        Returns: string
      }
      ai_learning_client_set: {
        Args: { p_client_ids: string[]; p_include: boolean; p_actor?: string | null }
        Returns: Json
      }
      notices_client_settings: {
        Args: never
        Returns: {
          id: string
          name: string
          gstin: string
          gst_user_id: string | null
          notices_handled: boolean
          notices_sync_excluded: boolean
          inactive_at_hand: boolean
          open_notices: number
          portal_login_issue: string | null
          portal_login_issue_message: string | null
          portal_login_issue_at: string | null
        }[]
      }
      notices_clients_handled_set: {
        Args: { p_client_ids: string[]; p_handled: boolean }
        Returns: number
      }
      client_login_issue_set: {
        Args: { p_client_id: string; p_reason: string | null; p_message?: string | null }
        Returns: boolean
      }
      ai_sync: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      ai_documents_request: {
        Args: { p_notice_id: string }
        Returns: number
      }
      ai_documents_retry: {
        Args: { p_ids: string[] }
        Returns: number
      }
      ai_learning_select: {
        Args: { p_document_ids: string[]; p_include: boolean; p_actor?: string | null }
        Returns: number
      }
      ai_learning_select_where: {
        Args: { p_client_ids: string[] | null; p_phase: string | null; p_include: boolean; p_actor?: string | null }
        Returns: number
      }
      ai_learning_pair_set: {
        Args: { p_pair_ids: string[]; p_include: boolean; p_actor?: string | null }
        Returns: number
      }
      ai_assist_feedback: {
        Args: { p_run_id: string; p_action: string; p_items?: Json | null; p_actor?: string | null }
        Returns: number
      }
      ai_assist_spend_today_usd: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      notice_reply_context: {
        Args: { p_notice_id: string }
        Returns: Json
      }
      notice_reply_option_use: {
        Args: { p_option_id: string; p_author_id?: string; p_author_name?: string }
        Returns: Json
      }
      notice_reply_options_refresh: {
        Args: { p_notice_id: string; p_force?: boolean }
        Returns: number
      }
      notice_type_hidden: {
        Args: { p_form_code: string }
        Returns: boolean
      }
      notice_type_set: {
        Args: { p_form_code: string; p_response_need?: string; p_show_on_dashboard?: boolean; p_actor_name?: string; p_hidden?: boolean }
        Returns: Json
      }
      reply_evidence_pending: {
        Args: { p_limit?: number }
        Returns: {
          notice_id: string
          client_id: string
          form_code: string
        }[]
      }
      reply_factory_status: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      client_doc_request_upload: {
        Args: { p_client_id: string; p_client_name?: string | null; p_document_id: string; p_note?: string | null; p_request_id: string }
        Returns: string
      }
      client_doc_requests: {
        Args: { p_client_id: string }
        Returns: {
          client_uploaded_at: string | null
          document_id: string | null
          due_date: string | null
          issue_title: string | null
          item: string
          notice_id: string
          notice_label: string | null
          reference_number: string | null
          request_id: string
          requested_at: string
          resolved_at: string | null
          status: string
        }[]
      }
      notice_doc_due_default: {
        Args: { p_notice_id: string }
        Returns: string
      }
      notice_doc_requests_generate: {
        Args: { p_actor_id?: string | null; p_actor_name?: string | null; p_due_date?: string | null; p_notice_id: string }
        Returns: Json
      }
      reply_annexure_save: {
        Args: {
          p_actor_name?: string | null
          p_explained?: number | null
          p_financial_year: string | null
          p_inputs_hash: string | null
          p_issue_id: string | null
          p_notice_id: string
          p_periods: string[]
          p_readiness: Json
          p_recipe_key: string
          p_status: string
          p_summary: Json
          p_tables: Json
          p_title: string | null
          p_to_pay?: number | null
        }
        Returns: Json
      }
      ai_read_status: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      ai_set_consent: {
        Args: { p_client_ids: string[]; p_consent_at: string | null; p_note?: string | null; p_opt_out?: boolean | null }
        Returns: number
      }
      notice_read_request: {
        Args: { p_actor_id?: string | null; p_actor_name?: string | null; p_notice_id: string; p_priority?: number | null }
        Returns: Json
      }
      notice_due_coverage: {
        Args: Record<PropertyKey, never>
        Returns: {
          due_on: string | null
          form_code: string | null
          kind: string
          notice_id: string
          source: string | null
        }[]
      }
      notice_issue_verify: {
        Args: { p_actor_name?: string | null; p_issue_id: string }
        Returns: boolean
      }
      notice_read_verify: {
        Args: { p_action: string; p_actor_name?: string | null; p_field: string; p_notice_id: string }
        Returns: string
      }
      notice_read_form: {
        Args: { p_notice_id: string }
        Returns: boolean
      }
      notice_read_portal: {
        Args: { p_notice_id: string }
        Returns: Json
      }
      autopilot_ask_client: {
        Args: { p_actor_name?: string | null; p_client_id: string; p_kind: string }
        Returns: Json
      }
      autopilot_badge: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      autopilot_enqueue: {
        Args: {
          p_client_ids?: string[] | null
          p_job_type?: string
          p_origin?: string
          p_payload?: Json
          p_priority?: number | null
          p_requested_by?: string | null
          p_requested_by_name?: string | null
          p_scope?: string
        }
        Returns: Json
      }
      autopilot_metrics: {
        Args: { p_days?: number }
        Returns: {
          captchas: number
          capture_median_hours: number | null
          captured_within_24h: number
          day: string
          eligible: number
          email_median_minutes: number | null
          fresh: number
          jobs_done: number
          jobs_failed: number
          named: number
          notices_captured: number
          share: number | null
          short_form_emails: number
          short_form_within_4h: number
          typing_minutes: number
          wall_minutes: number
          working: boolean
        }[]
      }
      autopilot_status: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      autopilot_wall_ping: {
        Args: { p_attentive?: boolean; p_name?: string | null; p_user_id?: string | null }
        Returns: Json
      }
      notice_calendar: {
        Args: { p_from: string; p_to: string }
        Returns: {
          client_id: string
          client_name: string
          day: string
          detail: string | null
          form_code: string | null
          kind: string
          notice_id: string
          owner: string | null
          owner_id: string | null
          reference: string | null
          stage: string
          title: string | null
        }[]
      }
      notice_hearings_upcoming: {
        Args: { p_from?: string | null }
        Returns: {
          client_id: string
          client_name: string
          hearing_at: string | null
          hearing_on: string
          kind: string
          matter_id: string | null
          note: string | null
          notice_id: string | null
          owner: string | null
          owner_id: string | null
          ref_id: string
          reference: string | null
          stage: string
          title: string | null
          venue: string | null
        }[]
      }
      notice_request_documents_send: {
        Args: { p_actor_id: string | null; p_actor_name: string; p_notice_id: string; p_reminder?: boolean }
        Returns: Json
      }
      notices_command_centre: {
        Args: { p_user_id?: string | null; p_filters?: Json | null }
        Returns: Json
      }
      notices_search: {
        Args: { p_limit?: number; p_q: string }
        Returns: Json
      }
      notice_alerts_run: {
        Args: { p_mode?: string }
        Returns: Json
      }
      notice_clocks_refresh: {
        Args: { p_notice_id?: string }
        Returns: Json
      }
      notices_auto_assign_open: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      notices_dashboard_summary: {
        Args: { p_category?: string }
        Returns: Json
      }
      portal_job_answer: {
        Args: {
          p_action?: string
          p_job_id: string
          p_prompt_id: string
          p_text?: string | null
          p_typing_ms?: number | null
          p_user_id?: string | null
          p_user_name?: string | null
        }
        Returns: string
      }
      portal_job_cancel: {
        Args: { p_by_name?: string | null; p_job_id: string }
        Returns: string
      }
      portal_job_retry: {
        Args: { p_by?: string | null; p_by_name?: string | null; p_job_id: string }
        Returns: Json
      }
      reply_has_dash: {
        Args: { p: string }
        Returns: boolean
      }
      reply_render: {
        Args: { p_body: string; p_ctx: Json }
        Returns: string
      }
      sync_ingest: {
        Args: {
          p_client_id: string
          p_complete?: boolean
          p_ext_version?: string
          p_rows: Json
          p_run_id: string | null
          p_scope?: string
          p_step: string
        }
        Returns: Json
      }
      sync_log_step: {
        Args: {
          p_client_id: string
          p_ext_version?: string
          p_message?: string
          p_reason_class?: string
          p_run_id: string | null
          p_status: string
          p_step: string
        }
        Returns: string
      }
      sync_queue: {
        Args: { p_client_ids?: string[] }
        Returns: {
          client_id: string
          gstin: string
          last_success_at: string | null
          name: string
          queue_reason: string
          urgent_notices: number
        }[]
      }
      sync_run_finish: {
        Args: { p_note?: string; p_run_id: string; p_status?: string }
        Returns: undefined
      }
      sync_run_start: {
        Args: { p_clients_total?: number; p_ext_version?: string; p_machine?: string; p_mode: string }
        Returns: string
      }
      notices_sweep: {
        Args: { p_client_id?: string }
        Returns: Json
      }
      save_annual_return_doc: {
        Args: {
          p_client_id: string
          p_data: Json
          p_doc_key: string
          p_expected_version: number
          p_financial_year: string
          p_action?: string
          p_force_history?: boolean
          p_role?: string
          p_updated_by: string
        }
        Returns: number
      }
      set_annual_return_status: {
        Args: {
          p_actor_id: string
          p_changes_ack?: number
          p_checklist?: Json
          p_client_id: string
          p_expected_rev: number
          p_financial_year: string
          p_note?: string
          p_override_reason?: string
          p_payables?: Json
          p_to: string
        }
        Returns: Json
      }
      annual_return_signoff: {
        Args: {
          p_action: string
          p_actor_id: string
          p_changes_ack?: number
          p_client_id: string
          p_expected_rev: number
          p_financial_year: string
          p_note?: string
          p_return_to?: string
        }
        Returns: Json
      }
      annual_return_allot: {
        Args: {
          p_actor_id: string
          p_financial_year: string
          p_items: Json
          p_stage: string
        }
        Returns: Json
      }
      annual_return_signoff_row: {
        Args: {
          p_client_id: string
          p_financial_year: string
        }
        Returns: Json
      }
      annual_return_unacked_changes: {
        Args: {
          p_actor_id: string
          p_client_id: string
          p_financial_year: string
          p_for: string
        }
        Returns: number
      }
      add_annual_return_setoff: {
        Args: {
          p_by: string
          p_cess: number
          p_cgst: number
          p_client_id: string
          p_doc_date?: string
          p_drc03_id?: string
          p_evidence_name?: string
          p_evidence_url?: string
          p_financial_year: string
          p_gstr3b_period?: string
          p_gstr3b_table?: string
          p_igst: number
          p_method: string
          p_note?: string
          p_reference?: string
          p_sgst: number
          p_side: string
        }
        Returns: string
      }
      remove_annual_return_setoff: {
        Args: { p_by: string; p_id: string; p_reason: string }
        Returns: undefined
      }
      authenticate_client: {
        Args: { identifier: string; pass: string }
        Returns: {
          client_email: string
          client_id: string
          client_name: string
          gstin: string
          is_first_login: boolean
        }[]
      }
      authenticate_staff: {
        Args: { identifier: string; pass: string }
        Returns: {
          email: string
          first_name: string
          is_first_login: boolean
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      builder_assert_gstr1_not_filed: {
        Args: { p_period: string; p_unit_id: string }
        Returns: undefined
      }
      builder_bu_agreement_confirm: {
        Args: { _action: string; _notes: string; _token: string }
        Returns: boolean
      }
      builder_bu_agreement_confirmation_blocked: {
        Args: { _client_id: string; _period_month: string }
        Returns: boolean
      }
      builder_bu_agreement_confirmation_lookup: {
        Args: { _token: string }
        Returns: {
          agreement_value: number
          project_name: string
          status: string
          unit_no: string
        }[]
      }
      builder_fsi_consent_blocked: {
        Args: { _client_id: string; _period_month: string }
        Returns: boolean
      }
      complete_client_first_login: {
        Args: { new_password: string; target_client_id: string }
        Returns: undefined
      }
      complete_first_login: {
        Args: { new_password: string; target_user_id: string }
        Returns: undefined
      }
      filing_effective_return_type: {
        Args: { p_base: string; p_client_id: string; p_period_month: string }
        Returns: string
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_user_snapshot: {
        Args: { target_user_id: string }
        Returns: {
          email: string
          first_name: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      mark_filing_pushed: {
        Args: {
          p_actor?: string | null
          p_client_id: string
          p_period_month: string
          p_return_type: string
        }
        Returns: string
      }
      reset_client_password: {
        Args: { new_password: string; target_client_id: string }
        Returns: boolean
      }
      reset_employee_password: {
        Args: { new_password: string; target_user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "superadmin" | "gst_manager" | "employee" | "client"
      filing_status_type:
        | "Prepared"
        | "Data Pending"
        | "Mismatch in Data"
        | "Not Verified"
        | "Filed"
        | "Prepared Pending"
        | "Data Received"
        | "Not to File"
        | "Pushed"
      registration_type:
        | "Regular"
        | "Composition"
        | "Tax Deductor"
        | "ISD"
        | "IFF"
      return_type:
        | "GSTR-1"
        | "GSTR-3B"
        | "ITC-04"
        | "GSTR-6"
        | "GSTR-7"
        | "CMP-08"
        | "GSTR-1 (IFF)"
        | "GSTR-3B (Q)"
        | "GSTR-1A"
        | "GSTR-9"
        | "GSTR-9C"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["superadmin", "gst_manager", "employee", "client"],
      filing_status_type: [
        "Prepared",
        "Data Pending",
        "Mismatch in Data",
        "Not Verified",
        "Filed",
        "Prepared Pending",
        "Data Received",
        "Not to File",
        "Pushed",
      ],
      registration_type: [
        "Regular",
        "Composition",
        "Tax Deductor",
        "ISD",
        "IFF",
      ],
      return_type: [
        "GSTR-1",
        "GSTR-3B",
        "ITC-04",
        "GSTR-6",
        "GSTR-7",
        "CMP-08",
        "GSTR-1 (IFF)",
        "GSTR-3B (Q)",
        "GSTR-1A",
        "GSTR-9",
        "GSTR-9C",
      ],
    },
  },
} as const

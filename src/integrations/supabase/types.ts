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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
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
          reversal_month: string | null
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
          reversal_month?: string | null
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
          reversal_month?: string | null
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
      clients: {
        Row: {
          assigned_accountant: string | null
          builder_itc_type: string | null
          cancellation_date: string | null
          client_password: string | null
          client_user_id: string | null
          commercial_area: number | null
          created_at: string | null
          created_by: string | null
          email: string | null
          gst_password: string | null
          gst_user_id: string | null
          gstin: string
          id: string
          is_first_login: boolean | null
          mobile: string | null
          name: string
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
          assigned_accountant?: string | null
          builder_itc_type?: string | null
          cancellation_date?: string | null
          client_password?: string | null
          client_user_id?: string | null
          commercial_area?: number | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          gst_password?: string | null
          gst_user_id?: string | null
          gstin: string
          id?: string
          is_first_login?: boolean | null
          mobile?: string | null
          name: string
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
          assigned_accountant?: string | null
          builder_itc_type?: string | null
          cancellation_date?: string | null
          client_password?: string | null
          client_user_id?: string | null
          commercial_area?: number | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          gst_password?: string | null
          gst_user_id?: string | null
          gstin?: string
          id?: string
          is_first_login?: boolean | null
          mobile?: string | null
          name?: string
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
      filing_status: {
        Row: {
          arn: string | null
          client_id: string
          filed_date: string | null
          id: string
          is_locked: boolean | null
          period_month: string
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
          period_month: string
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
          period_month?: string
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
      books_register: {
        Row: {
          book_treatment: string | null
          client_id: string
          created_at: string | null
          date: string | null
          id: string
          input_cgst: number | null
          input_igst: number | null
          input_sgst: number | null
          matched_2b_id: string | null
          period_month: string
          supplier_gstin: string | null
          supplier_invoice_number: string | null
          supplier_name: string | null
          taxable_value: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          book_treatment?: string | null
          client_id: string
          created_at?: string | null
          date?: string | null
          id?: string
          input_cgst?: number | null
          input_igst?: number | null
          input_sgst?: number | null
          matched_2b_id?: string | null
          period_month: string
          supplier_gstin?: string | null
          supplier_invoice_number?: string | null
          supplier_name?: string | null
          taxable_value?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          book_treatment?: string | null
          client_id?: string
          created_at?: string | null
          date?: string | null
          id?: string
          input_cgst?: number | null
          input_igst?: number | null
          input_sgst?: number | null
          matched_2b_id?: string | null
          period_month?: string
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
      suspended_reco: {
        Row: {
          client_id: string
          id: string
          opening_cgst: number | null
          opening_igst: number | null
          opening_sgst: number | null
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
          opening_igst?: number | null
          opening_sgst?: number | null
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
          opening_igst?: number | null
          opening_sgst?: number | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      complete_client_first_login: {
        Args: { new_password: string; target_client_id: string }
        Returns: undefined
      }
      complete_first_login: {
        Args: { new_password: string; target_user_id: string }
        Returns: undefined
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
      app_role: ["superadmin", "gst_manager", "employee", "client"],
      filing_status_type: [
        "Prepared",
        "Data Pending",
        "Mismatch in Data",
        "Not Verified",
        "Filed",
        "Prepared Pending",
        "Data Received",
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
      ],
    },
  },
} as const

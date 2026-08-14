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
    PostgrestVersion: "14.5"
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
            referencedRelation: "builder_units"
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
          gstr1_import_mode: string
          id: string
          inactive_at_hand: boolean
          is_first_login: boolean | null
          mobile: string | null
          name: string
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
          gstr1_import_mode?: string
          id?: string
          inactive_at_hand?: boolean
          is_first_login?: boolean | null
          mobile?: string | null
          name: string
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
          gstr1_import_mode?: string
          id?: string
          inactive_at_hand?: boolean
          is_first_login?: boolean | null
          mobile?: string | null
          name?: string
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
      email_outbox: {
        Row: {
          body: string
          client_id: string
          created_at: string
          created_by: string | null
          error: string | null
          filing_status_id: string | null
          id: string
          kind: string
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
          client_id: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          filing_status_id?: string | null
          id?: string
          kind: string
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
          client_id?: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          filing_status_id?: string | null
          id?: string
          kind?: string
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
      filing_status: {
        Row: {
          arn: string | null
          client_id: string
          filed_date: string | null
          id: string
          is_locked: boolean | null
          is_nil: boolean
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
          is_nil?: boolean
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
          is_nil?: boolean
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
          attempts: number
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
          payload: Json | null
          period_month: string | null
          requested_by: string | null
          result: Json | null
          status: string
          updated_at: string | null
          verified: boolean | null
        }
        Insert: {
          attempts?: number
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
          payload?: Json | null
          period_month?: string | null
          requested_by?: string | null
          result?: Json | null
          status?: string
          updated_at?: string | null
          verified?: boolean | null
        }
        Update: {
          attempts?: number
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
          payload?: Json | null
          period_month?: string | null
          requested_by?: string | null
          result?: Json | null
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
    }
    Views: {
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
        | "Not to File"
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
      ],
    },
  },
} as const

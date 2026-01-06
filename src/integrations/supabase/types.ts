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
      clients: {
        Row: {
          assigned_accountant: string | null
          cancellation_date: string | null
          client_user_id: string | null
          created_at: string | null
          created_by: string | null
          email: string | null
          gstin: string
          id: string
          mobile: string | null
          name: string
          registration_date: string
          registration_type: Database["public"]["Enums"]["registration_type"]
          selected_returns: Database["public"]["Enums"]["return_type"][] | null
          updated_at: string | null
        }
        Insert: {
          assigned_accountant?: string | null
          cancellation_date?: string | null
          client_user_id?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          gstin: string
          id?: string
          mobile?: string | null
          name: string
          registration_date: string
          registration_type?: Database["public"]["Enums"]["registration_type"]
          selected_returns?: Database["public"]["Enums"]["return_type"][] | null
          updated_at?: string | null
        }
        Update: {
          assigned_accountant?: string | null
          cancellation_date?: string | null
          client_user_id?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          gstin?: string
          id?: string
          mobile?: string | null
          name?: string
          registration_date?: string
          registration_type?: Database["public"]["Enums"]["registration_type"]
          selected_returns?: Database["public"]["Enums"]["return_type"][] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      filing_status: {
        Row: {
          client_id: string
          filed_date: string | null
          id: string
          is_locked: boolean | null
          period_month: string
          remarks: string | null
          return_type: Database["public"]["Enums"]["return_type"]
          status: Database["public"]["Enums"]["filing_status_type"] | null
          target_date: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          client_id: string
          filed_date?: string | null
          id?: string
          is_locked?: boolean | null
          period_month: string
          remarks?: string | null
          return_type: Database["public"]["Enums"]["return_type"]
          status?: Database["public"]["Enums"]["filing_status_type"] | null
          target_date?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          filed_date?: string | null
          id?: string
          is_locked?: boolean | null
          period_month?: string
          remarks?: string | null
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
      twob_versions: {
        Row: {
          client_id: string
          id: string
          is_current: boolean | null
          period_month: string
          table_type: string
          updated_at: string | null
          updated_by: string | null
          version_data: Json | null
          version_number: number | null
        }
        Insert: {
          client_id: string
          id?: string
          is_current?: boolean | null
          period_month: string
          table_type: string
          updated_at?: string | null
          updated_by?: string | null
          version_data?: Json | null
          version_number?: number | null
        }
        Update: {
          client_id?: string
          id?: string
          is_current?: boolean | null
          period_month?: string
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
    }
    Enums: {
      app_role: "superadmin" | "gst_manager" | "employee" | "client"
      filing_status_type:
        | "Prepared"
        | "Data Pending"
        | "Mismatch in Data"
        | "Not Verified"
        | "Filed"
      registration_type: "Regular" | "Composition" | "Tax Deductor" | "ISD"
      return_type:
        | "GSTR-1"
        | "GSTR-3B"
        | "ITC-04"
        | "GSTR-6"
        | "GSTR-7"
        | "CMP-08"
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
      ],
      registration_type: ["Regular", "Composition", "Tax Deductor", "ISD"],
      return_type: [
        "GSTR-1",
        "GSTR-3B",
        "ITC-04",
        "GSTR-6",
        "GSTR-7",
        "CMP-08",
      ],
    },
  },
} as const

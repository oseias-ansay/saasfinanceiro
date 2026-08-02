export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      attachments: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          tenant_id: string
          transaction_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          tenant_id: string
          transaction_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          tenant_id?: string
          transaction_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_dashboard_kpis"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_staff_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            referencedRelation: "vw_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          diff: Json | null
          id: number
          record_id: string | null
          table_name: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          diff?: Json | null
          id?: number
          record_id?: string | null
          table_name: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          diff?: Json | null
          id?: number
          record_id?: string | null
          table_name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_dashboard_kpis"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_staff_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_number: string | null
          agency: string | null
          bank_code: string | null
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          opening_balance: number
          opening_balance_date: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          agency?: string | null
          bank_code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          opening_balance?: number
          opening_balance_date?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          agency?: string | null
          bank_code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          opening_balance?: number
          opening_balance_date?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_dashboard_kpis"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_staff_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          color: string | null
          created_at: string
          dre_group: Database["public"]["Enums"]["dre_group"]
          id: string
          is_active: boolean
          name: string
          parent_id: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          dre_group: Database["public"]["Enums"]["dre_group"]
          id?: string
          is_active?: boolean
          name: string
          parent_id?: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          dre_group?: Database["public"]["Enums"]["dre_group"]
          id?: string
          is_active?: boolean
          name?: string
          parent_id?: string | null
          tenant_id?: string
          type?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_dashboard_kpis"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "categories_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_staff_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_centers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_centers_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_centers_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_dashboard_kpis"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "cost_centers_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_staff_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["entity_type"]
          name: string
          notes: string | null
          phone: string | null
          tax_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["entity_type"]
          name: string
          notes?: string | null
          phone?: string | null
          tax_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["entity_type"]
          name?: string
          notes?: string | null
          phone?: string | null
          tax_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entities_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entities_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_dashboard_kpis"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "entities_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_staff_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          is_active: boolean
          role: Database["public"]["Enums"]["member_role"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          is_active?: boolean
          role?: Database["public"]["Enums"]["member_role"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          is_active?: boolean
          role?: Database["public"]["Enums"]["member_role"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_dashboard_kpis"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_staff_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_profiles_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
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
          kind: string
          link: string | null
          meta: Json
          read_at: string | null
          ref_date: string
          severity: Database["public"]["Enums"]["notification_severity"]
          tenant_id: string
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          kind: string
          link?: string | null
          meta?: Json
          read_at?: string | null
          ref_date?: string
          severity?: Database["public"]["Enums"]["notification_severity"]
          tenant_id: string
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          kind?: string
          link?: string | null
          meta?: Json
          read_at?: string | null
          ref_date?: string
          severity?: Database["public"]["Enums"]["notification_severity"]
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_dashboard_kpis"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_staff_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_staff: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_staff?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_staff?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      recurring_templates: {
        Row: {
          amount: number
          bank_account_id: string | null
          category_id: string | null
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          day_of_month: number | null
          description: string
          end_date: string | null
          entity_id: string | null
          frequency: Database["public"]["Enums"]["recurrence_frequency"]
          generate_ahead_days: number
          id: string
          interval_count: number
          is_active: boolean
          last_generated_at: string | null
          max_occurrences: number | null
          next_due_date: string
          occurrences_created: number
          start_date: string
          tenant_id: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          category_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          day_of_month?: number | null
          description: string
          end_date?: string | null
          entity_id?: string | null
          frequency?: Database["public"]["Enums"]["recurrence_frequency"]
          generate_ahead_days?: number
          id?: string
          interval_count?: number
          is_active?: boolean
          last_generated_at?: string | null
          max_occurrences?: number | null
          next_due_date: string
          occurrences_created?: number
          start_date: string
          tenant_id: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          category_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          day_of_month?: number | null
          description?: string
          end_date?: string | null
          entity_id?: string | null
          frequency?: Database["public"]["Enums"]["recurrence_frequency"]
          generate_ahead_days?: number
          id?: string
          interval_count?: number
          is_active?: boolean
          last_generated_at?: string | null
          max_occurrences?: number | null
          next_due_date?: string
          occurrences_created?: number
          start_date?: string
          tenant_id?: string
          type?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_templates_bank_account_id_fkey"
            columns: ["bank_account_id"]
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_templates_category_id_fkey"
            columns: ["category_id"]
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_templates_cost_center_id_fkey"
            columns: ["cost_center_id"]
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_templates_entity_id_fkey"
            columns: ["entity_id"]
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_dashboard_kpis"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "recurring_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_staff_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          fiscal_regime: string | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["tenant_kind"]
          legal_name: string | null
          name: string
          tax_id: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          fiscal_regime?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["tenant_kind"]
          legal_name?: string | null
          name: string
          tax_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          fiscal_regime?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["tenant_kind"]
          legal_name?: string | null
          name?: string
          tax_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          bank_account_id: string | null
          category_id: string | null
          competence_date: string
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          description: string
          document_number: string | null
          due_date: string
          entity_id: string | null
          id: string
          installment_number: number | null
          installment_total: number | null
          notes: string | null
          paid_amount: number | null
          paid_date: string | null
          parent_id: string | null
          recurring_template_id: string | null
          schedule_type: Database["public"]["Enums"]["schedule_type"]
          status: Database["public"]["Enums"]["transaction_status"]
          tenant_id: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          category_id?: string | null
          competence_date: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          document_number?: string | null
          due_date: string
          entity_id?: string | null
          id?: string
          installment_number?: number | null
          installment_total?: number | null
          notes?: string | null
          paid_amount?: number | null
          paid_date?: string | null
          parent_id?: string | null
          recurring_template_id?: string | null
          schedule_type?: Database["public"]["Enums"]["schedule_type"]
          status?: Database["public"]["Enums"]["transaction_status"]
          tenant_id: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          category_id?: string | null
          competence_date?: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          document_number?: string | null
          due_date?: string
          entity_id?: string | null
          id?: string
          installment_number?: number | null
          installment_total?: number | null
          notes?: string | null
          paid_amount?: number | null
          paid_date?: string | null
          parent_id?: string | null
          recurring_template_id?: string | null
          schedule_type?: Database["public"]["Enums"]["schedule_type"]
          status?: Database["public"]["Enums"]["transaction_status"]
          tenant_id?: string
          type?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_cost_center_id_fkey"
            columns: ["cost_center_id"]
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_entity_id_fkey"
            columns: ["entity_id"]
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_parent_id_fkey"
            columns: ["parent_id"]
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_parent_id_fkey"
            columns: ["parent_id"]
            referencedRelation: "vw_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_recurring_template_id_fkey"
            columns: ["recurring_template_id"]
            referencedRelation: "recurring_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_dashboard_kpis"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_staff_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      vw_cashflow_daily: {
        Row: {
          data: string | null
          entradas: number | null
          resultado_dia: number | null
          saidas: number | null
          saldo_acumulado: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_dashboard_kpis"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_staff_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_cashflow_projection: {
        Row: {
          alerta_saldo_negativo: boolean | null
          data: string | null
          dias_a_frente: number | null
          entradas_previstas: number | null
          resultado_previsto: number | null
          saidas_previstas: number | null
          saldo_atual: number | null
          saldo_projetado: number | null
          tenant_id: string | null
          valor_em_atraso: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_dashboard_kpis"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_staff_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_dashboard_kpis: {
        Row: {
          pagar_30d: number | null
          pagar_atrasado: number | null
          receber_30d: number | null
          receber_atrasado: number | null
          saldo_hoje: number | null
          tenant_id: string | null
        }
        Insert: {
          pagar_30d?: never
          pagar_atrasado?: never
          receber_30d?: never
          receber_atrasado?: never
          saldo_hoje?: never
          tenant_id?: string | null
        }
        Update: {
          pagar_30d?: never
          pagar_atrasado?: never
          receber_30d?: never
          receber_atrasado?: never
          saldo_hoje?: never
          tenant_id?: string | null
        }
        Relationships: []
      }
      vw_dre_monthly: {
        Row: {
          competencia: string | null
          custos_variaveis: number | null
          deducoes: number | null
          despesas_fixas: number | null
          margem_contribuicao: number | null
          margem_contribuicao_pct: number | null
          outras_despesas: number | null
          outras_receitas: number | null
          ponto_equilibrio: number | null
          receita_bruta: number | null
          receita_liquida: number | null
          resultado_liquido: number | null
          resultado_operacional: number | null
          retiradas_socios: number | null
          tenant_id: string | null
          variacao_patrimonio: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_dashboard_kpis"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_staff_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_expenses_by_category: {
        Row: {
          category_name: string | null
          color: string | null
          competencia: string | null
          dre_group: Database["public"]["Enums"]["dre_group"] | null
          qtd: number | null
          tenant_id: string | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_dashboard_kpis"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_staff_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_pf_monthly: {
        Row: {
          competencia: string | null
          comprometimento_fixo_pct: number | null
          custo_total: number | null
          gastos_fixos: number | null
          gastos_variaveis: number | null
          outros_gastos: number | null
          rendas: number | null
          sobra: number | null
          taxa_poupanca_pct: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_dashboard_kpis"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_staff_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_staff_tenants: {
        Row: {
          created_at: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          qtd_lancamentos: number | null
          qtd_usuarios: number | null
          tax_id: string | null
          ultimo_lancamento: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          qtd_lancamentos?: never
          qtd_usuarios?: never
          tax_id?: string | null
          ultimo_lancamento?: never
        }
        Update: {
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          qtd_lancamentos?: never
          qtd_usuarios?: never
          tax_id?: string | null
          ultimo_lancamento?: never
        }
        Relationships: []
      }
      vw_transactions: {
        Row: {
          amount: number | null
          bank_account_id: string | null
          bank_account_name: string | null
          category_id: string | null
          category_name: string | null
          competence_date: string | null
          cost_center_id: string | null
          cost_center_name: string | null
          created_at: string | null
          days_to_due: number | null
          description: string | null
          document_number: string | null
          dre_group: Database["public"]["Enums"]["dre_group"] | null
          due_date: string | null
          entity_email: string | null
          entity_id: string | null
          entity_name: string | null
          entity_phone: string | null
          has_attachment: boolean | null
          id: string | null
          installment_number: number | null
          installment_total: number | null
          notes: string | null
          paid_amount: number | null
          paid_date: string | null
          schedule_type: Database["public"]["Enums"]["schedule_type"] | null
          situacao: string | null
          status: Database["public"]["Enums"]["transaction_status"] | null
          tenant_id: string | null
          type: Database["public"]["Enums"]["transaction_type"] | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_cost_center_id_fkey"
            columns: ["cost_center_id"]
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_entity_id_fkey"
            columns: ["entity_id"]
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_dashboard_kpis"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            referencedRelation: "vw_staff_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      auth_tenant_ids: { Args: never; Returns: string[] }
      can_write_tenant: { Args: { p_tenant_id: string }; Returns: boolean }
      fn_add_frequency: {
        Args: {
          p_count?: number
          p_date: string
          p_freq: Database["public"]["Enums"]["recurrence_frequency"]
        }
        Returns: string
      }
      fn_apply_day_of_month: {
        Args: { p_date: string; p_day: number }
        Returns: string
      }
      fn_create_transaction: {
        Args: {
          p_amount: number
          p_amount_mode?: string
          p_bank_account_id?: string
          p_category_id?: string
          p_competence_date?: string
          p_competence_mode?: string
          p_cost_center_id?: string
          p_description: string
          p_document_number?: string
          p_due_date: string
          p_entity_id?: string
          p_frequency?: Database["public"]["Enums"]["recurrence_frequency"]
          p_installments?: number
          p_notes?: string
          p_tenant_id: string
          p_type: Database["public"]["Enums"]["transaction_type"]
        }
        Returns: {
          amount: number
          bank_account_id: string | null
          category_id: string | null
          competence_date: string
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          description: string
          document_number: string | null
          due_date: string
          entity_id: string | null
          id: string
          installment_number: number | null
          installment_total: number | null
          notes: string | null
          paid_amount: number | null
          paid_date: string | null
          parent_id: string | null
          recurring_template_id: string | null
          schedule_type: Database["public"]["Enums"]["schedule_type"]
          status: Database["public"]["Enums"]["transaction_status"]
          tenant_id: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      fn_daily_digest: { Args: { p_tenant_id: string }; Returns: Json }
      fn_digest_all: {
        Args: never
        Returns: {
          atrasado_pagar: number
          atrasado_receber: number
          primeiro_dia_negativo: string
          qtd_atrasados: number
          recipients: string[]
          saldo_atual: number
          tenant_id: string
          tenant_name: string
          titulos: Json
          vence_hoje_pagar: number
          vence_hoje_receber: number
        }[]
      }
      fn_due_alerts: {
        Args: { p_days?: number }
        Returns: {
          amount: number
          category_name: string
          days_to_due: number
          description: string
          due_date: string
          entity_email: string
          entity_name: string
          entity_phone: string
          tenant_id: string
          tenant_name: string
          transaction_id: string
          type: Database["public"]["Enums"]["transaction_type"]
        }[]
      }
      fn_generate_recurring: {
        Args: { p_horizon?: string; p_tenant_id?: string }
        Returns: {
          generated: number
          template_id: string
        }[]
      }
      fn_notify: {
        Args: {
          p_body?: string
          p_kind: string
          p_link?: string
          p_meta?: Json
          p_severity?: Database["public"]["Enums"]["notification_severity"]
          p_tenant_id: string
          p_title: string
        }
        Returns: string
      }
      fn_seed_categorias_pessoais: {
        Args: { p_tenant_id: string }
        Returns: number
      }
      fn_seed_default_categories: {
        Args: { p_tenant_id: string }
        Returns: number
      }
      fn_settle_transactions: {
        Args: {
          p_bank_account_id?: string
          p_ids: string[]
          p_paid_amount?: number
          p_paid_date?: string
        }
        Returns: number
      }
      fn_unsettle_transactions: { Args: { p_ids: string[] }; Returns: number }
      is_platform_staff: { Args: never; Returns: boolean }
      is_tenant_admin: { Args: { p_tenant_id: string }; Returns: boolean }
      is_tenant_member: { Args: { p_tenant_id: string }; Returns: boolean }
    }
    Enums: {
      dre_group:
        | "receita_bruta"
        | "deducao"
        | "custo_variavel"
        | "despesa_fixa"
        | "outras_receitas"
        | "outras_despesas"
        | "retirada_socios"
      entity_type: "cliente" | "fornecedor" | "ambos"
      member_role: "owner" | "admin" | "member" | "viewer"
      notification_severity: "info" | "warning" | "critical"
      recurrence_frequency:
        | "diaria"
        | "semanal"
        | "quinzenal"
        | "mensal"
        | "bimestral"
        | "trimestral"
        | "semestral"
        | "anual"
      schedule_type: "avista" | "parcelado" | "recorrente"
      tenant_kind: "empresa" | "pessoa_fisica"
      transaction_status: "pendente" | "liquidado" | "cancelado"
      transaction_type: "receita" | "despesa"
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
      dre_group: [
        "receita_bruta",
        "deducao",
        "custo_variavel",
        "despesa_fixa",
        "outras_receitas",
        "outras_despesas",
        "retirada_socios",
      ],
      entity_type: ["cliente", "fornecedor", "ambos"],
      member_role: ["owner", "admin", "member", "viewer"],
      notification_severity: ["info", "warning", "critical"],
      recurrence_frequency: [
        "diaria",
        "semanal",
        "quinzenal",
        "mensal",
        "bimestral",
        "trimestral",
        "semestral",
        "anual",
      ],
      schedule_type: ["avista", "parcelado", "recorrente"],
      tenant_kind: ["empresa", "pessoa_fisica"],
      transaction_status: ["pendente", "liquidado", "cancelado"],
      transaction_type: ["receita", "despesa"],
    },
  },
} as const

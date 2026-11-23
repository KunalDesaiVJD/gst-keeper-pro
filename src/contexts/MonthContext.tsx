import React, { createContext, useContext, useState, useCallback } from 'react';

interface MonthContextType {
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
}

const MONTH_KEY = 'gstk_selected_month';

const MonthContext = createContext<MonthContextType | undefined>(undefined);

export const MonthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const now = new Date();
  // Default to previous month (Return Period) - GST returns filed in current month are for previous month
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defaultMonth = `${String(prevMonth.getMonth() + 1).padStart(2, '0')}/${prevMonth.getFullYear()}`;
  // Kept for this tab only, so a reload (a new build, Reload on an error card) keeps the period.
  const [selectedMonth, setSelectedMonthState] = useState<string>(() => {
    try {
      const v = sessionStorage.getItem(MONTH_KEY);
      if (v && /^(0[1-9]|1[0-2])\/\d{4}$/.test(v)) return v;
    } catch { /* storage unavailable */ }
    return defaultMonth;
  });

  const setSelectedMonth = useCallback((month: string) => {
    setSelectedMonthState(month);
    try { sessionStorage.setItem(MONTH_KEY, month); } catch { /* storage unavailable */ }
  }, []);

  return (
    <MonthContext.Provider value={{ selectedMonth, setSelectedMonth }}>
      {children}
    </MonthContext.Provider>
  );
};

export const useMonth = (): MonthContextType => {
  const context = useContext(MonthContext);
  if (context === undefined) {
    throw new Error('useMonth must be used within a MonthProvider');
  }
  return context;
};

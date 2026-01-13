import React, { createContext, useContext, useState, useCallback } from 'react';

interface MonthContextType {
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
}

const MonthContext = createContext<MonthContextType | undefined>(undefined);

export const MonthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const now = new Date();
  const defaultMonth = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  const [selectedMonth, setSelectedMonthState] = useState<string>(defaultMonth);

  const setSelectedMonth = useCallback((month: string) => {
    setSelectedMonthState(month);
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

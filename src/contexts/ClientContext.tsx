import React, { createContext, useContext, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface ClientContextType {
  selectedClientId: string;
  setSelectedClientId: (clientId: string) => void;
}

const ClientContext = createContext<ClientContextType | undefined>(undefined);

export const ClientProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isStaffRole } = useAuth();
  const [selectedClientId, setSelectedClientIdState] = useState<string>('');

  const setSelectedClientId = useCallback((clientId: string) => {
    if (user && !isStaffRole()) {
      setSelectedClientIdState(user.id);
      return;
    }
    setSelectedClientIdState(clientId);
  }, [user, isStaffRole]);

  const effectiveClientId = user && !isStaffRole() ? user.id : selectedClientId;

  return (
    <ClientContext.Provider value={{ selectedClientId: effectiveClientId, setSelectedClientId }}>
      {children}
    </ClientContext.Provider>
  );
};

export const useClient = (): ClientContextType => {
  const context = useContext(ClientContext);
  if (context === undefined) {
    throw new Error('useClient must be used within a ClientProvider');
  }
  return context;
};

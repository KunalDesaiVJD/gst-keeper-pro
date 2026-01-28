import React, { createContext, useContext, useState, useCallback } from 'react';

interface ClientContextType {
  selectedClientId: string;
  setSelectedClientId: (clientId: string) => void;
}

const ClientContext = createContext<ClientContextType | undefined>(undefined);

export const ClientProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedClientId, setSelectedClientIdState] = useState<string>('');

  const setSelectedClientId = useCallback((clientId: string) => {
    setSelectedClientIdState(clientId);
  }, []);

  return (
    <ClientContext.Provider value={{ selectedClientId, setSelectedClientId }}>
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

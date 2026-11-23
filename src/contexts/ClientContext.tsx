import React, { createContext, useContext, useState, useCallback } from 'react';

interface ClientContextType {
  selectedClientId: string;
  setSelectedClientId: (clientId: string) => void;
}

const CLIENT_KEY = 'gstk_selected_client';

const ClientContext = createContext<ClientContextType | undefined>(undefined);

export const ClientProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Kept for this tab only, so a reload (a new build, Reload on an error card) keeps the client.
  const [selectedClientId, setSelectedClientIdState] = useState<string>(() => {
    try { return sessionStorage.getItem(CLIENT_KEY) ?? ''; } catch { return ''; }
  });

  const setSelectedClientId = useCallback((clientId: string) => {
    setSelectedClientIdState(clientId);
    try {
      if (clientId) sessionStorage.setItem(CLIENT_KEY, clientId);
      else sessionStorage.removeItem(CLIENT_KEY);
    } catch { /* storage unavailable */ }
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

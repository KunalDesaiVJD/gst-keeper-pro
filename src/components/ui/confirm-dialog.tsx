import * as React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** Style the confirm button as destructive (red). Default false. */
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

/**
 * App-wide styled confirmation. Replaces native confirm() with a themed
 * AlertDialog. Usage:
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Delete client?', description: '…', destructive: true, confirmText: 'Delete' })) { … }
 */
export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = React.useState<{ open: boolean; opts: ConfirmOptions }>({
    open: false,
    opts: { title: '' },
  });
  const resolverRef = React.useRef<(v: boolean) => void>();

  const confirm = React.useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState({ open: true, opts });
    });
  }, []);

  const settle = React.useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = undefined;
    setState((s) => ({ ...s, open: false }));
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={state.open} onOpenChange={(o) => { if (!o) settle(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{state.opts.title}</AlertDialogTitle>
            {state.opts.description != null && (
              <AlertDialogDescription>{state.opts.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {state.opts.cancelText || 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => settle(true)}
              className={cn(state.opts.destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90')}
            >
              {state.opts.confirmText || 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
};

export const useConfirm = (): ConfirmFn => {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
};

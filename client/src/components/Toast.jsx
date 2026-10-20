import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { errorMessage } from '../lib/api';

const ToastContext = createContext(null);
const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);
  const show = useCallback((message, type = 'info', options = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list.slice(-3), { id, message, type, ...options }]);
    setTimeout(() => dismiss(id), options.duration || (type === 'error' ? 6000 : 3500));
  }, [dismiss]);

  const value = useMemo(() => ({
    show,
    success: (message, options) => show(message, 'success', options),
    error: (message, options) => show(message, 'error', options),
    info: (message, options) => show(message, 'info', options),
    // Runs an action, toasting its error (or the optional success message). Resolves true on success.
    run: async (work, successMessage) => {
      try {
        await work();
        if (successMessage) show(successMessage, 'success');
        return true;
      } catch (error) {
        show(errorMessage(error), 'error');
        return false;
      }
    },
  }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((toast) => {
            const Icon = ICONS[toast.type];
            return (
              <div key={toast.id} className={`toast toast-${toast.type}`}>
                <Icon size={18} />
                <div className="toast-body">
                  {toast.title && <strong>{toast.title}</strong>}
                  <span>{toast.message}</span>
                </div>
                {toast.action && (
                  <button type="button" className="toast-action" onClick={() => { toast.action.onClick(); dismiss(toast.id); }}>
                    {toast.action.label}
                  </button>
                )}
                <button type="button" className="toast-close" onClick={() => dismiss(toast.id)} aria-label="Dismiss"><X size={16} /></button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

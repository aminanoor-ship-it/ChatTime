import { createContext, useCallback, useContext, useState } from 'react';
import Modal from './Modal';

const ConfirmContext = createContext(null);

// confirm({ title, message, confirmLabel, danger }) resolves true/false.
export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);

  const confirm = useCallback((options) => new Promise((resolve) => setRequest({ ...options, resolve })), []);
  const finish = (answer) => {
    request?.resolve(answer);
    setRequest(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <Modal
          title={request.title}
          onClose={() => finish(false)}
          width={420}
          footer={(
            <>
              <button type="button" className="btn btn-ghost" onClick={() => finish(false)}>Cancel</button>
              <button type="button" className={`btn ${request.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => finish(true)}>
                {request.confirmLabel || 'Confirm'}
              </button>
            </>
          )}
        >
          <p className="confirm-text">{request.message}</p>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);

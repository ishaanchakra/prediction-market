'use client';
import { useCallback, useRef, useState } from 'react';

export default function useToastQueue() {
  const [toasts, setToasts] = useState([]);
  const confirmResolvers = useRef(new Map());

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    confirmResolvers.current.delete(id);
  }, []);

  const pushToast = useCallback((message, type = 'error', duration = 3000) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    if (type !== 'confirm' && duration > 0) {
      setTimeout(() => removeToast(id), duration);
    }
    return id;
  }, [removeToast]);

  const notifyError = useCallback((message) => {
    pushToast(message, 'error', 3000);
  }, [pushToast]);

  const notifySuccess = useCallback((message) => {
    pushToast(message, 'success', 3000);
  }, [pushToast]);

  const confirmToast = useCallback((message) => {
    const id = pushToast(message, 'confirm', 0);
    return new Promise((resolve) => {
      confirmResolvers.current.set(id, resolve);
    });
  }, [pushToast]);

  const resolveConfirm = useCallback((id, accepted) => {
    const resolve = confirmResolvers.current.get(id);
    if (resolve) resolve(accepted);
    removeToast(id);
  }, [removeToast]);

  return {
    toasts,
    notifyError,
    notifySuccess,
    confirmToast,
    removeToast,
    resolveConfirm
  };
}

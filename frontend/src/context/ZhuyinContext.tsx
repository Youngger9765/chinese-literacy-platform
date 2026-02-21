import React, { createContext, useContext, useState } from 'react';

interface ZhuyinContextValue {
  zhuyinEnabled: boolean;
  setZhuyinEnabled: (enabled: boolean) => void;
}

const ZhuyinContext = createContext<ZhuyinContextValue>({
  zhuyinEnabled: true,
  setZhuyinEnabled: () => {},
});

export const ZhuyinProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [zhuyinEnabled, setZhuyinEnabled] = useState(true);
  return (
    <ZhuyinContext.Provider value={{ zhuyinEnabled, setZhuyinEnabled }}>
      {children}
    </ZhuyinContext.Provider>
  );
};

export function useZhuyin(): ZhuyinContextValue {
  return useContext(ZhuyinContext);
}

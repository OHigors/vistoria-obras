import { createContext, useContext, useState, type ReactNode } from 'react';

export type AreaFilter = 'Exterior' | 'Interior';

const AreaFilterContext = createContext<{
  areaFilter: AreaFilter;
  setAreaFilter: (a: AreaFilter) => void;
}>({ areaFilter: 'Interior', setAreaFilter: () => {} });

export function AreaFilterProvider({ children }: { children: ReactNode }) {
  const [areaFilter, setAreaFilter] = useState<AreaFilter>('Interior');
  return (
    <AreaFilterContext.Provider value={{ areaFilter, setAreaFilter }}>
      {children}
    </AreaFilterContext.Provider>
  );
}

export const useAreaFilter = () => useContext(AreaFilterContext);

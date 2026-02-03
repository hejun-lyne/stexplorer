import React, { PropsWithChildren, createContext, useContext } from 'react';
import { useScroll } from 'ahooks';
import classnames from 'classnames';
import styles from './index.scss';

export interface HeaderContextType {
  miniMode: boolean;
}

export const headerContext = createContext<HeaderContextType>({
  miniMode: false,
});

export function useHeaderContext() {
  const context = useContext(headerContext);
  return context;
}

const Header: React.FC<PropsWithChildren<Record<string, unknown>>> = ({ children }) => {
  const position = useScroll(document, (val) => val.top <= 520);
  const miniMode = position.top > 40;
  return (
    <headerContext.Provider
      value={{
        miniMode,
      }}
    >
      <div className={classnames(styles.layout)}>
        <div className={classnames(styles.content, { [styles.miniMode]: miniMode })}>{children}</div>
      </div>
    </headerContext.Provider>
  );
};
export default Header;

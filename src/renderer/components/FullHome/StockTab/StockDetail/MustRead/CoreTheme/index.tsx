import React, { useCallback, useEffect, useState } from 'react';
import styles from '../index.scss';
import * as Services from '@/services';
import * as Utils from '@/utils';
import * as CONST from '@/constants';
import { useRequest } from 'ahooks';
import { useWorkDayTimeToDo } from '@/utils/hooks';
import classnames from 'classnames';
import { Button } from 'antd';
import { setStockHybk } from '@/actions/stock';
import { useDispatch } from 'react-redux';

export interface CoreThemeProps {
  active: boolean;
  code: string;
  secid: string;
  onOpenStock: (secid: string, name: string, change?: number) => void;
}

const CoreTheme: React.FC<CoreThemeProps> = React.memo(({ active, code, secid, onOpenStock }) => {
  const [activeTheme, setActiveTheme] = useState<any>();
  const [themes, setThemes] = useState<any[]>();
  const [themeLeadings, setThemeLeadings] = useState<Record<string, any[]>>({});
  const { run: runGetThemeLeadings } = useRequest(Services.Stock.GetThemeLeadings, {
    throwOnError: true,
    manual: true,
    onSuccess: ({ bk, data }) => {
      if (bk && data) {
        themeLeadings[bk] = data;
        setThemeLeadings(Utils.DeepCopy(themeLeadings));
      }
    },
  });
  const { run: runGetThemes } = useRequest(Services.Stock.GetStockThemes, {
    throwOnError: true,
    manual: true,
    onSuccess: (data: any[]) => {
      if (data && data.length > 0) {
        if (!activeTheme) {
          setActiveTheme(data[0]);
          runGetThemeLeadings(data[0].DERIVE_BOARD_CODE);
        }
        setThemes(data);
      }
    },
  });
  const renewData = useCallback(() => {
    runGetThemes(code);
    if (themes?.length) {
      themes.forEach((t) => runGetThemeLeadings(t.DERIVE_BOARD_CODE));
    }
  }, []);
  useWorkDayTimeToDo(
    () => {
      renewData();
    },
    active ? CONST.DEFAULT.STOCK_TREND_DELAY : null
  );

  useEffect(() => {
    renewData();
  }, []);
  const dispatch = useDispatch();
  return (
    <div className={styles.themeWrapper}>
      <div className={styles.themetabs}>
        {themes &&
          themes.map((t) => (
            <div
              key={t.DERIVE_BOARD_CODE}
              className={classnames(styles.tab, Utils.GetValueColor(t.BOARD_YIELD).blockClass, {
                [styles.active]: activeTheme.DERIVE_BOARD_CODE === t.DERIVE_BOARD_CODE,
              })}
              onClick={() => {
                setActiveTheme(t);
                runGetThemeLeadings(t.DERIVE_BOARD_CODE);
              }}
            >
              <div>{t.BOARD_NAME}</div>
              <div>{t.BOARD_YIELD}%</div>
            </div>
          ))}
      </div>
      <div className={styles.themedetail}>
        {activeTheme && (
          <>
            <div className={styles.title} style={{ cursor: 'pointer' }}>
              <span onClick={() => onOpenStock('90.' + activeTheme.NEW_BOARD_CODE, activeTheme.BOARD_NAME, activeTheme.BOARD_YIELD)}>
                {activeTheme.BOARD_NAME}
              </span>
              &nbsp;
              <a onClick={() => dispatch(setStockHybk(secid, activeTheme.NEW_BOARD_CODE, activeTheme.BOARD_NAME))}>设为活跃</a>
            </div>
            <div className={styles.detail}>{activeTheme.SELECTED_BOARD_REASON}</div>
            <div className={styles.title}>人气龙头</div>
            <div className={styles.wrapper}>
              {themeLeadings[activeTheme.DERIVE_BOARD_CODE]?.map((s) => (
                <div
                  className={classnames(styles.stock, Utils.GetValueColor(s.YIELD).blockClass)}
                  key={s.SECURITY_CODE}
                  onClick={() =>
                    onOpenStock((s.SECURITY_CODE.startsWith('6') ? '1.' : '0.') + s.SECURITY_CODE, s.SECURITY_NAME_ABBR, s.YIELD)
                  }
                >
                  <div>{s.SECURITY_NAME_ABBR}</div>
                  <div>
                    <span>{s.NEWEST_PRICE}</span>
                    <span>&nbsp;&nbsp;</span>
                    <span>{s.YIELD}%</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
});
export default CoreTheme;

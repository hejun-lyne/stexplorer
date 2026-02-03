import React, { useEffect, useState } from 'react';
import * as Services from '@/services';
import PureCard from '@/components/Card/PureCard';
import styles from './index.scss';
import classnames from 'classnames';
import * as Utils from '@/utils';
import * as CONST from '@/constants';
import { useRequest } from 'ahooks';
import { Stock } from '@/types/stock';
import { useWorkDayTimeToDo } from '@/utils/hooks';
import { Button } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { setStockHybk } from '@/actions/stock';
import { useDispatch } from 'react-redux';

export interface BanKuaiProps {
  secid: string;
  active: boolean;
  openBankuai: (secid: string, name: string, change?: number) => void;
}

const BanKuai: React.FC<BanKuaiProps> = React.memo(({ secid, active, openBankuai }) => {
  const [bankuais, setBankuais] = useState<Stock.BanKuai[]>([]);
  const { run: runGetBankuais } = useRequest(Services.Stock.GetStockBankuaisFromEastmoney, {
    throwOnError: true,
    manual: true,
    defaultParams: [secid],
    onSuccess: setBankuais,
    cacheKey: `GetStockBankuaisFromEastmoney/${secid}`,
  });
  useWorkDayTimeToDo(
    () => {
      runGetBankuais(secid);
    },
    active ? CONST.DEFAULT.STOCK_TREND_DELAY : null
  );
  // 确保首次有数据
  useEffect(() => {
    runGetBankuais(secid);
  }, [secid]);
  const dispatch = useDispatch();
  return (
    <PureCard>
      <div className={classnames(styles.content, 'scroll-enabled')}>
        {bankuais.length ? (
          bankuais.map((bankuai) => (
            <div key={bankuai.code}>
              <a onClick={() => openBankuai(bankuai.secid, bankuai.name, bankuai.zdf)}>
                <label style={{ marginRight: 16, cursor: 'pointer', display: 'inline-block', width: 50 }}>{bankuai.name}</label>
              </a>
              <a onClick={() => dispatch(setStockHybk(secid, bankuai.code, bankuai.name))}>
                <span className={classnames(Utils.GetValueColor(bankuai.zdf).textClass)}>{Utils.Yang(bankuai.zdf)}%</span>
                &nbsp;
                <CheckOutlined />
              </a>
            </div>
          ))
        ) : (
          <div>无板块数据~</div>
        )}
      </div>
    </PureCard>
  );
});
export default BanKuai;

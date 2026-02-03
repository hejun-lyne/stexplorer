import React, { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { addStockAction } from '@/actions/stock';
import { StoreState } from '@/reducers/types';
import { stockTypesConfig } from '../LeftSider';
import * as Helpers from '@/helpers';
import * as Services from '@/services';
import CustomDrawerContent from '@/components/CustomDrawer/Content';
import { Tabs } from 'antd';
import styles from './index.scss';
import { useRequest } from 'ahooks';
import { Empty } from 'antd';
import { Stock } from '@/types/stock';
import { StockMarketType } from '@/utils/enums';

export interface AddStockProps {
  onClose: () => void;
  onOpenStock: (secid: string, name: string, type?: StockMarketType) => void;
  text: string;
}

const AddStock: React.FC<AddStockProps> = ({ onClose, onOpenStock, text }) => {
  const { stockConfigs } = useSelector((state: StoreState) => state.stock);
  const [none, setNone] = useState<boolean>(false);
  const dispatch = useDispatch();

  // 固定数据
  const [futrues] = useState<any[]>([
    {
      Name: '纳指期货',
      Code: 'NQ',
      MktNum: '9',
    },
  ]);
  // 搜索操作
  const [groupList, setGroupList] = useState<Stock.SearchResult[]>([]);
  const { run: runSearch } = useRequest(Services.Stock.SearchFromEastmoney2, {
    manual: true,
    throwOnError: true,
    onSuccess: (res) => setGroupList(res.filter(({ Type }) => stockTypesConfig.map(({ code }) => code).includes(Type))),
  });

  useEffect(() => {
    runSearch(text);
  }, [runSearch, text]);

  // 添加操作
  const onAdd = async (secid: string, type: number, name?: string) => {
    const details = type == StockMarketType.Future ? await Helpers.Stock.GetFutureDetail(secid) : await Helpers.Stock.GetStockDetail(secid);
    if (name) {
      details.name = name;
    }
    if (details) {
      setNone(false);
      dispatch(addStockAction(details, type));
      onClose();
    } else {
      setNone(true);
    }
  };

  return (
    <CustomDrawerContent title="添加股票" onClose={onClose}>
      {none && (
        <section>
          <span className={styles.none}>添加股票失败，未找到或数据出错~</span>
        </section>
      )}
      {groupList.length ? (
        <Tabs animated={{ tabPane: true }} tabBarGutter={15} tabBarStyle={{ marginLeft: 15 }}>
          {groupList.map(({ Datas, Name, Type }) => (
            <Tabs.TabPane tab={Name} key={String(Type)}>
              {Datas.map(({ Name, Code, MktNum }) => {
                const secid = `${MktNum}.${Code}`;
                return (
                  <div key={secid} className={styles.stock}>
                    <div>
                      <div className={styles.name}>
                        <a className={styles.nameText} onClick={() => onOpenStock(secid, Name)}>
                          {Name}
                        </a>
                      </div>
                      <div className={styles.code}>{Code}</div>
                    </div>
                    {stockConfigs.find((s) => s.secid === secid) ? (
                      <button className={styles.added} disabled>
                        已添加
                      </button>
                    ) : (
                      <button
                        className={styles.select}
                        onClick={(e) => {
                          onAdd(secid, Type);
                          e.stopPropagation();
                        }}
                      >
                        自选
                      </button>
                    )}
                  </div>
                );
              })}
            </Tabs.TabPane>
          ))}
          <Tabs.TabPane tab={'期货'} key={String(StockMarketType.Future)}>
            {futrues.map(({ Name, Code, MktNum }) => {
              const secid = `${Code}`;
              return (
                <div key={secid} className={styles.stock}>
                  <div>
                    <div className={styles.name}>
                      <a className={styles.nameText} onClick={() => onOpenStock(secid, Name, StockMarketType.Future)}>
                        {Name}
                      </a>
                    </div>
                    <div className={styles.code}>{Code}</div>
                  </div>
                  {stockConfigs.find((s) => s.secid === secid) ? (
                    <button className={styles.added} disabled>
                      已添加
                    </button>
                  ) : (
                    <button
                      className={styles.select}
                      onClick={(e) => {
                        onAdd(secid, StockMarketType.Future, Name);
                        e.stopPropagation();
                      }}
                    >
                      自选
                    </button>
                  )}
                </div>
              );
            })}
          </Tabs.TabPane>
        </Tabs>
      ) : (
        <Empty description="暂无相关数据~" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </CustomDrawerContent>
  );
};

export default AddStock;

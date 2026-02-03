import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Services from '@/services';
import PureCard from '@/components/Card/PureCard';
import styles from './index.scss';
import classnames from 'classnames';
import * as Utils from '@/utils';
import * as CONST from '@/constants';
import * as Helpers from '@/helpers';
import { useRequest } from 'ahooks';
import { Stock } from '@/types/stock';
import { useRenderEcharts, useResizeEchart, useWorkDayTimeToDo } from '@/utils/hooks';
import { Button, Checkbox, Col, DatePicker, Radio, Row, Select, Table, Tabs, Timeline } from 'antd';
import { CloudDownloadOutlined, EyeOutlined, InteractionOutlined, PieChartOutlined, PlusOutlined, RobotOutlined, SaveOutlined, StepForwardOutlined, UndoOutlined, VerticalAlignBottomOutlined, VerticalAlignTopOutlined } from '@ant-design/icons';
import { BKType, KFilterType, KFilterTypeNames, StockMarketType } from '@/utils/enums';
import { batch, useDispatch, useSelector } from 'react-redux';
import { useHomeContext } from '../..';
import QSTMonitor from './QSTMonitor';
import moment from 'moment';
import { StoreState } from '@/reducers/types';
import { setStockTrainingAction } from '@/actions/stock';

export interface QuantTestProps {
  active: boolean;
  openStock: (secid: string, name: string, change?: number) => void;
}
function getTBaseChartOptions(darkMode: boolean) {
  return {
    title: {
      show: false,
    },
    colors: ['#ec0000', '#00da3c'],
    darkMode,
    animation: false,
    grid: [
      // 价格
      {
        top: '2%',
        left: '10%',
        width: '80%',
        height: '84%',
      },
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
      },
    },
    series: [{}],
  };
}
function getTxAxis() {
  return [
    // 价格时间轴
    {
      type: 'category',
      scale: true,
      boundaryGap: false,
      splitLine: {
        show: false,
      },
      splitNumber: 10,
      axisPointer: {
        z: 100,
      },
    },
  ];
}
function getTyAxis(darkMode: boolean) {
  return [
    {
      type: 'value',
      scale: true,
      position: 'left',
      axisLabel: {
        interval: 0,
        formatter: '{value}%',
      },
      axisLine: {
        lineStyle: {
          color: '#b1afb3',
          width: 1,
        },
      },
      splitLine: {
        lineStyle: {
          color: darkMode ? 'rgba(255,255,255, 0.15)' : 'rgba(0, 0, 0, 0.15)',
          type: 'dashed',
        },
      },
    },
  ];
}
function getTrendSeries() {
  return [
    {
      type: 'line',
      name: '净值',
      showSymbol: false,
      symbol: 'circle',
      smooth: false,
      lineStyle: {
        width: 2,
        opacity: 0.5,
      },
    },
  ];
}
function setupTrendChart(darkMode: boolean) {
  const options = getTBaseChartOptions(darkMode);
  options.xAxis = getTxAxis();
  options.yAxis = getTyAxis(darkMode);
  options.series = getTrendSeries();
  return options;
}
function updateTrendChart(opts: any, darkMode: boolean, actions: Stock.QuantActionItem[]) {
  opts.darkMode = darkMode;
  const times = actions.map(({ day }) => day.format('YYYY-MM-DD'));
  for (let i = 0; i < opts.xAxis.length; i++) {
    opts.xAxis[i].data = times;
  }
  opts.series[0].data = actions.map(
    ({ holds, availableMoney }) => holds.reduce((s, a) => a.amount * a.price * (1 + a.profit) + s, 0.0) + availableMoney
  );
  return { ...opts };
}
const QuantTest: React.FC<QuantTestProps> = React.memo(({ active, openStock }) => {
  const [running, setRunning] = useState(false);
  const { darkMode } = useHomeContext();
  const contentRef = useRef<HTMLDivElement>(null);
  const [dates, setDates] = useState([]);
  const { ref: chartRef, chartInstance: chart } = useResizeEchart(-1);
  const [trendOption, setTrendOption] = useState<any>(setupTrendChart(darkMode));
  const [msg, setMsg] = useState('');
  const doTest = useCallback(() => {
    if (dates.length) {
      setRunning(true);
      setTimeout(() => {
        Helpers.Stock.TestQuantStrategy(
          dates[0],
          dates[1],
          BKType.Gainian,
          6,
          3,
          3,
          (actions) => {
            setTrendOption(updateTrendChart(trendOption, darkMode, actions));
            setActs([...actions]);
          },
          (message) => {
            setMsg(message);
          },
          () => {
            setRunning(false);
          }
        );
      }, 0);
    }
  }, [dates]);
  const [activeKey, setActiveKey] = useState('perf');
  const [monitors, setMonitors] = useState([] as string[]);
  const addMonitors = useCallback(
    (ss: string[]) => {
      let nm = monitors;
      ss.forEach((s) => {
        if (monitors.indexOf(s) == -1) {
          nm = [s].concat(nm);
        }
      });
      setMonitors(nm);
    },
    [monitors]
  );
  const moveMonitoToTop = useCallback(
    (s: string) => {
      monitors.sort(function (a, b) {
        return a == s ? -1 : b == s ? 1 : 0;
      });
      setMonitors([...monitors]);
    },
    [monitors]
  );
  const removeMonitor = useCallback(
    (s: string[]) => {
      const ms = monitors.filter((m) => s.indexOf(m) == -1);
      setMonitors(ms);
    },
    [monitors]
  );
  const stcolumns = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 80,
      fixed: 'left',
      render: (d, r) => <a onClick={() => addMonitors([r.secid])}>{d}</a>,
    },
    {
      title: '板块',
      dataIndex: 'bkname',
      width: 80,
      fixed: 'left',
      render: (d, r) => <a onClick={() => addMonitors([r.bksecid])}>{d}</a>,
    },
    {
      title: '涨跌',
      dataIndex: 'zdf',
      sorter: (a, b) => a.zdf - b.zdf,
      defaultSortOrder: 'ascend',
      width: 60,
      fixed: 'left',
      render: (d) => <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>,
    },
    {
      title: '市值',
      dataIndex: 'lt',
      sorter: (a, b) => a.lt - b.lt,
      render: (d) => d > 100000000 ? `${(d / 100000000).toFixed(2)}亿` : `${(d / 10000000).toFixed(2)}千万`
      width: 60,
      defaultSortOrder: 'ascend',
    },
    {
      title: '上涨',
      dataIndex: 'zdays_5d',
      sorter: (a, b) => a.zdays_5d - b.zdays_5d,
      defaultSortOrder: 'descend',
      render: (d) => `${d} / 5`,
      width: 60,
    },
    {
      title: '上涨',
      dataIndex: 'zdays_10d',
      sorter: (a, b) => a.zdays_10d - b.zdays_10d,
      defaultSortOrder: 'descend',
      render: (d) => `${d} / 10`,
      width: 60,
    },
    {
      title: '涨停',
      dataIndex: 'zt_5d',
      sorter: (a, b) => a.zt_5d - b.zt_5d,
      defaultSortOrder: 'descend',
      render: (d) => `${d} / 5`,
      width: 60,
    },
    {
      title: '涨停',
      dataIndex: 'zt_10d',
      sorter: (a, b) => a.zt_10d - b.zt_10d,
      render: (d) => `${d} / 10`,
      defaultSortOrder: 'descend',
      width: 60,
    },
    {
      title: '-1H',
      dataIndex: 'b1d_hsl',
      sorter: (a, b) => a.b1d_hsl - b.b1d_hsl,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => !d ? '--' : `${d.toFixed(2)}%`
    },
    {
      title: '-3H',
      dataIndex: 'b3d_hsl',
      sorter: (a, b) => a.b3d_hsl - b.b3d_hsl,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => !d ? '--' : `${d.toFixed(2)}%`
    },
    {
      title: '-3H_C',
      dataIndex: 'b3d_hsl_c',
      sorter: (a, b) => a.b3d_hsl / a.b5d_hsl - b.b3d_hsl / b.b5d_hsl,
      defaultSortOrder: 'descend',
      width: 70,
      render: (_, r) => `${((r.b3d_hsl / r.b5d_hsl - 1) * 100).toFixed(2)}%`
    },
    {
      title: '-5H',
      dataIndex: 'b5d_hsl',
      sorter: (a, b) => a.b5d_hsl - b.b5d_hsl,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => !d ? '--' : `${d.toFixed(2)}%`
    },
    {
      title: '-5H_C',
      dataIndex: 'b5d_hsl_c',
      sorter: (a, b) => a.b5d_hsl / a.b10d_hsl - b.b5d_hsl / b.b10d_hsl,
      defaultSortOrder: 'descend',
      width: 70,
      render: (_, r) => `${((r.b5d_hsl / r.b10d_hsl - 1) * 100).toFixed(2)}%`
    },
    {
      title: '-10H',
      dataIndex: 'b10d_hsl',
      sorter: (a, b) => a.b10d_hsl - b.b10d_hsl,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => !d ? '--' : `${d.toFixed(2)}%`
    },
    {
      title: '-1D',
      dataIndex: 'b1d_zdf',
      sorter: (a, b) => a.b1d_zdf - b.b1d_zdf,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => !d ? '--' : <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>
    },
    {
      title: '-3D',
      dataIndex: 'b3d_zdf',
      sorter: (a, b) => a.b3d_zdf - b.b3d_zdf,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => !d ? '--' : <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>
    },
    {
      title: '-5D',
      dataIndex: 'b5d_zdf',
      sorter: (a, b) => a.b5d_zdf - b.b5d_zdf,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => !d ? '--' : <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>
    },
    {
      title: '-10D',
      dataIndex: 'b10d_zdf',
      sorter: (a, b) => a.b10d_zdf - b.b10d_zdf,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => !d ? '--' : <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>
    },
    {
      title: '-20D',
      dataIndex: 'b20d_zdf',
      sorter: (a, b) => a.b20d_zdf - b.b20d_zdf,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => !d ? '--' : <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>
    },
    {
      title: '-1R',
      dataIndex: 'b1d_rank',
      sorter: (a, b) => a.b1d_rank - b.b1d_rank,
      defaultSortOrder: 'ascend',
      width: 60,
    },
    {
      title: '-3R',
      dataIndex: 'b3d_rank',
      sorter: (a, b) => a.b3d_rank - b.b3d_rank,
      defaultSortOrder: 'ascend',
      width: 60,
    },
    {
      title: '-3C',
      dataIndex: 'b3d_rank_c',
      sorter: (a, b) => -(a.b20d_rank - a.b3d_rank) + (b.b20d_rank - b.b3d_rank),
      defaultSortOrder: 'ascend',
      width: 60,
      render: (d, r) => -(r.b20d_rank - r.b3d_rank)
    },
    {
      title: '-5R',
      dataIndex: 'b5d_rank',
      sorter: (a, b) => a.b5d_rank - b.b5d_rank,
      defaultSortOrder: 'ascend',
      width: 60,
    },
    {
      title: '-5C',
      dataIndex: 'b5d_rank_c',
      sorter: (a, b) => -(a.b20d_rank - a.b5d_rank) + (b.b20d_rank - b.b5d_rank),
      defaultSortOrder: 'ascend',
      width: 60,
      render: (d, r) => -(r.b20d_rank - r.b5d_rank)
    },
    {
      title: '-10R',
      dataIndex: 'b10d_rank',
      sorter: (a, b) => a.b10d_rank - b.b10d_rank,
      defaultSortOrder: 'ascend',
      width: 60,
    },
    {
      title: '-10C',
      dataIndex: 'b10d_rank_c',
      sorter: (a, b) => -(a.b20d_rank - a.b10d_rank) + (b.b20d_rank - b.b10d_rank),
      defaultSortOrder: 'ascend',
      width: 60,
      render: (d, r) => -(r.b20d_rank - r.b10d_rank)
    },
    {
      title: '-20R',
      dataIndex: 'b20d_rank',
      sorter: (a, b) => a.b20d_rank - b.b20d_rank,
      defaultSortOrder: 'ascend',
      width: 60,
    },
    {
      title: 'LHB',
      dataIndex: 'lhb_date',
      sorter: (a, b) => a.lhb_date > b.lhb_date ? 1 : -1,
      defaultSortOrder: 'descend',
      width: 100,
    },
  ];
  const [stdata, setSTData] = useState([]);
  const bkcolumns = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 80,
      fixed: 'left',
      render: (d, r) => <a onClick={() => addMonitors([r.secid])}>{d}</a>,
    },
    {
      title: '涨跌',
      dataIndex: 'zdf',
      sorter: (a, b) => a.zdf - b.zdf,
      defaultSortOrder: 'ascend',
      width: 80,
      fixed: 'left',
      render: (d) => !d ? '--' : <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>,
    },
    // {
    //   title: '价格',
    //   dataIndex: 'zx',
    //   sorter: (a, b) => a.zx - b.zx,
    //   defaultSortOrder: 'ascend',
    //   width: 80,
    //   render: (d) => d.toFixed(2),
    // },
    {
      title: '市值',
      dataIndex: 'lt',
      sorter: (a, b) => a.zsz - b.zsz,
      render: (d) => d > 100000000 ? `${(d / 100000000).toFixed(2)}亿` : `${(d / 10000000).toFixed(2)}千万`
      width: 90,
      defaultSortOrder: 'ascend',
    },
    {
      title: '上涨',
      dataIndex: 'zdays_5d',
      sorter: (a, b) => a.zdays_5d - b.zdays_5d,
      defaultSortOrder: 'descend',
      render: (d) => !d ? '--' : `${d} / 5`,
      width: 60,
    },
    {
      title: '上涨',
      dataIndex: 'zdays_10d',
      sorter: (a, b) => a.zdays_10d - b.zdays_10d,
      defaultSortOrder: 'descend',
      render: (d) => !d ? '--' : `${d} / 10`,
      width: 60,
    },
    {
      title: '-1H',
      dataIndex: 'b1d_hsl',
      sorter: (a, b) => a.b1d_hsl - b.b1d_hsl,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d, r) => !d ? '--' : `${d.toFixed(2)}%`
    },
    {
      title: '-3H',
      dataIndex: 'b3d_hsl',
      sorter: (a, b) => a.b3d_hsl - b.b3d_hsl,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => !d ? '--' : `${d.toFixed(2)}%`
    },
    {
      title: '-3H_C',
      dataIndex: 'b3d_hsl_c',
      sorter: (a, b) => a.b3d_hsl / a.b5d_hsl - b.b3d_hsl / b.b5d_hsl,
      defaultSortOrder: 'descend',
      width: 70,
      render: (_, r) => `${((r.b3d_hsl / r.b5d_hsl - 1) * 100).toFixed(2)}%`
    },
    {
      title: '-5H',
      dataIndex: 'b5d_hsl',
      sorter: (a, b) => a.b5d_hsl - b.b5d_hsl,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => !d ? '--' : `${d.toFixed(2)}%`
    },
    {
      title: '-5H_C',
      dataIndex: 'b5d_hsl_c',
      sorter: (a, b) => a.b5d_hsl / a.b10d_hsl - b.b5d_hsl / b.b10d_hsl,
      defaultSortOrder: 'descend',
      width: 70,
      render: (_, r) => `${((r.b5d_hsl / r.b10d_hsl - 1) * 100).toFixed(2)}%`
    },
    {
      title: '-10H',
      dataIndex: 'b10d_hsl',
      sorter: (a, b) => a.b10d_hsl - b.b10d_hsl,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => !d ? '--' : `${d.toFixed(2)}%`
    },
    {
      title: '-1D',
      dataIndex: 'b1d_zdf',
      sorter: (a, b) => a.b1d_zdf - b.b1d_zdf,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => !d ? '--' : <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>
    },
    {
      title: '-3D',
      dataIndex: 'b3d_zdf',
      sorter: (a, b) => a.b3d_zdf - b.b3d_zdf,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => !d ? '--' : <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>
    },
    {
      title: '-5D',
      dataIndex: 'b5d_zdf',
      sorter: (a, b) => a.b5d_zdf - b.b5d_zdf,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => !d ? '--' : <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>
    },
    {
      title: '-10D',
      dataIndex: 'b10d_zdf',
      sorter: (a, b) => a.b10d_zdf - b.b10d_zdf,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => !d ? '--' : <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>
    },
    {
      title: '-20D',
      dataIndex: 'b20d_zdf',
      sorter: (a, b) => a.b20d_zdf - b.b20d_zdf,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => !d ? '--' : <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>
    },
    {
      title: '-1R',
      dataIndex: 'b1d_rank',
      sorter: (a, b) => a.b1d_rank - b.b1d_rank,
      defaultSortOrder: 'ascend',
      width: 60,
    },
    {
      title: '-3R',
      dataIndex: 'b3d_rank',
      sorter: (a, b) => a.b3d_rank - b.b3d_rank,
      defaultSortOrder: 'ascend',
      width: 60,
    },
    {
      title: '-5R',
      dataIndex: 'b5d_rank',
      sorter: (a, b) => a.b5d_rank - b.b5d_rank,
      defaultSortOrder: 'ascend',
      width: 60,
    },
    {
      title: '-10R',
      dataIndex: 'b10d_rank',
      sorter: (a, b) => a.b10d_rank - b.b10d_rank,
      defaultSortOrder: 'ascend',
      width: 60,
    },
    {
      title: '-20R',
      dataIndex: 'b20d_rank',
      sorter: (a, b) => a.b20d_rank - b.b20d_rank,
      defaultSortOrder: 'ascend',
      width: 60,
    },
  ];
  const [bkdata, setBKData] = useState([]);
  const [activeAct, setActiveAct] = useState<Stock.QuantActionItem | undefined>(undefined);
  const [bktype, setBKType] = useState(BKType.Industry);
  const [bkstats, setBKStats] = useState<Record<string, Stock.KLineStatisticItem[]>>({});
  const [activeDay, setActiveDay] = useState('none');
  const [nexDay, setNexDay] = useState('none');
  const [activeBKStats, setActiveBKStats] = useState<Stock.KLineStatisticItem[]>([]);
  const { trainings } = useSelector((state: StoreState) => state.stock);
  const [actions, setActions] = useState<Stock.QuantActionItem[]>(trainings);
  // useEffect(() => {
  //   if (actions.length == 0 && trainings.length > 0) {
  //     setActions(trainings);
  //   }
  // }, trainings);
  useRenderEcharts(
    () => {
      chart?.setOption(updateTrendChart(trendOption, darkMode, actions), true);
    },
    chart,
    [darkMode, trendOption, actions]
  );
  const dispatch = useDispatch();
  const updateActions = useCallback((d: string) => {
    if (actions.length) {
      const act = actions[actions.length - 1];
      if (act.day.isSame(d, 'day')) {
        act.holds.forEach((h) => {
          const ks = Helpers.Stock.QuantGetKline(h.secid);
          const k = ks.find((_) => _.date == d);
          if (k) {
            h.profit = (k.sp - h.price) / h.price;
          }
        });
        setActions([...actions]);
        dispatch(setStockTrainingAction(actions));
      }
    }
  }, [actions, activeDay]);
  const changeDay = useCallback((d) => {
    const days = Object.keys(bkstats);
    const idx = days.indexOf(d);
    updateActions(nexDay);
    batch(() => {
      setActiveDay(d);
      setNexDay(days[idx < days.length - 1 ? (idx + 1) : idx]);
      if (bkstats[d]) {
        setActiveBKStats(bkstats[d]);
      }
    });
  }, [bkstats, actions, nexDay]);
  const toNextDay = useCallback(() => {
    const days = Object.keys(bkstats);
    const idx = days.indexOf(activeDay);
    if (idx < days.length - 1) {
      changeDay(days[idx + 1]);
    }
  }, [bkstats, activeDay, actions]);
  const { run: runGetBK } = useRequest(Helpers.Stock.QuantBKAnalyze, {
    throwOnError: true,
    manual: true,
    onSuccess: (data) => {
      if (data) {
        const days = Object.keys(data);
        const firstDay = days[0];
        batch(() => {
          setBKStats(data);
          setActiveDay(firstDay);
          setNexDay(days[1]);
          setActiveBKStats(data[firstDay]);
        })
      }

    },
    cacheKey: `QuantBKAnalyze`,
  });
  const mayRunGetBK = useCallback(() => {
    if (dates.length > 1) {
      runGetBK(dates[0], dates[1], bktype, setMsg);
    }
  }, [dates, bktype]);
  const [activeBk, setActiveBk] = useState('none');
  const [ststats, setSTStats] = useState<Stock.KLineStatisticItem[]>([]);
  const { run: runGetST } = useRequest(Helpers.Stock.QuantStsAnalyze, {
    throwOnError: true,
    manual: true,
    onSuccess: setSTStats,
    cacheKey: `QuantSTAnalyze`,
  });
  const { run: runGetAllST } = useRequest(Helpers.Stock.QuantAllStsAnalyze, {
    throwOnError: true,
    manual: true,
    onSuccess: setSTStats,
    cacheKey: `QuantAllSTAnalyze`,
  });
  const mayRunGetST = useCallback(() => {
    if (activeBk != 'none' && activeDay != 'none') {
      runGetST(activeBk, activeDay, setMsg);
    }
  }, [activeBk, activeDay]);
  const mayRunAllST = useCallback(() => {
    if (activeDay != 'none') {
      runGetAllST(activeDay, setMsg);
    }
  }, [activeDay]);
  const toggleSecid = useCallback((secid) => {
    let act = actions.find((_) => _.day.isSame(activeDay, 'day'));
    if (!act) {
      act = {
        day: moment(activeDay),
        choosenBks: [],
        choosenSts: [],
        makeBuys: [],
        makeSells: [],
        holds: [],
        wins: 0,
        loss: 0,
        availableMoney: 100000,
        totalProfit: 0
      } as unknown as Stock.QuantActionItem;
      actions.push(act);
    }
    if (Helpers.Stock.GetStockType(secid) == StockMarketType.Quotation) {
      // 选择板块
      if (act.choosenBks.find((_) => _.secid == secid)) {
        act.choosenBks = act.choosenBks.filter((_) => _.secid != secid);
      } else {
        const detail = Helpers.Stock.QuantGetDetail(secid);
        if (detail) {
          act.choosenBks.push(detail);
        }
      }
    } else {
      // 选择标的
      if (act.choosenSts.find((_) => _.secid == secid)) {
        act.choosenSts = act.choosenSts.filter((_) => _.secid != secid);
      } else {
        const detail = Helpers.Stock.QuantGetDetail(secid);
        if (detail) {
          act.choosenSts.push(detail);
        }
      }
    }
    setActions([...actions]);
    dispatch(setStockTrainingAction(actions));
  }, [actions, activeDay]);
  const doBuy = useCallback((ssecid: string, price: number) => {
    let act = actions.find((_) => _.day.isSame(nexDay, 'day'));
    if (!act) {
      const prevAct = actions.length ? actions[actions.length - 1] : null;
      if (!prevAct || prevAct.day.isAfter(nexDay)) {
        setMsg('操作无法完成，不能穿越时间');
        return;
      }
      act = {
        day: moment(nexDay),
        choosenBks: prevAct.choosenBks || [],
        choosenSts: prevAct.choosenSts || [],
        makeBuys: [],
        makeSells: [],
        holds: prevAct ? [...prevAct.holds] : [],
        wins: prevAct?.wins || 0,
        loss: prevAct?.loss || 0,
        availableMoney: prevAct?.availableMoney || 100000,
        totalProfit: prevAct?.totalProfit || 0
      } as unknown as Stock.QuantActionItem;
      actions.push(act);
    }
    if (act.holds.length >= 5) {
      setMsg('超过最高持有');
      return;
    }
    let availableMoney = act.availableMoney;
    let st = Helpers.Stock.QuantGetDetail(ssecid);
    const money = availableMoney / (5 - act.holds.length);
    const amount = Math.floor(money / price / 100) * 100;
    if (amount <= 0) {
      setMsg('资金余额不足无法买入');
      return;
    }
    availableMoney -= amount * price;
    act.availableMoney = availableMoney;
    const buy = {
      secid: ssecid,
      name: st.name,
      price,
      amount,
    };
    if (act.makeBuys) {
      act.makeBuys.push(buy);
    } else {
      act.makeBuys = [buy];
    }
    const hold = {
      secid: ssecid,
      name: st.name,
      price,
      amount,
      profit: 0,
      day: moment(nexDay),
    };
    if (act.holds) {
      act.holds.push(hold);
    } else {
      act.holds = [hold];
    }
    setActions([...actions]);
    dispatch(setStockTrainingAction(actions));
  }, [actions, nexDay]);
  const doSell = useCallback((ssecid: string, price: number) => {
    let act = actions.find((_) => _.day.isSame(nexDay, 'day'));
    if (!act) {
      const prevAct = actions.length ? actions[actions.length - 1] : null;
      if (prevAct && prevAct.day.isAfter(nexDay)) {
        setMsg('操作无法完成，不能穿越时间');
        return;
      }
      act = {
        day: moment(nexDay),
        choosenBks: prevAct?.choosenBks || [],
        choosenSts: prevAct?.choosenSts || [],
        makeBuys: [],
        makeSells: [],
        holds: prevAct ? [...prevAct.holds] : [],
        wins: prevAct?.wins || 0,
        loss: prevAct?.loss || 0,
        availableMoney: prevAct?.availableMoney || 100000,
        totalProfit: prevAct?.totalProfit || 0
      } as unknown as Stock.QuantActionItem;
      actions.push(act);
    }
    const h = act.holds.find((_) => _.secid == ssecid && !_.day.isSame(nexDay, 'day'));
    if (!h) {
      setMsg('卖出失败，未持有该标的');
      return;
    }
    const s = {
      secid: ssecid,
      name: h.name,
      price,
      profit: price / h.price - 1,
    };
    if (act.makeSells) {
      act.makeSells.push(s);
    } else {
      act.makeSells = [s];
    }
    // 更新战绩
    if (s.profit > 0) {
      act.wins += 1;
    } else {
      act.loss += 1;
    }
    act.totalProfit += s.profit;
    // 回收资金
    act.availableMoney += h.amount * price;
    // 更新持仓
    act.holds = act.holds.filter((_) => _ !== h);
    setActions([...actions]);
    dispatch(setStockTrainingAction(actions));
  }, [actions, nexDay]);
  const currentAct = actions.find((_) => _.day.isSame(activeDay, 'day'));
  const [fullList, setFullList] = useState(false);
  const [fullWidth, setFullWidth] = useState(false);
  const { accessToken } = useSelector((state: StoreState) => state.baidu);
  const saveFFlows = useCallback(() => {
    if (!accessToken) {
      setMsg(`需要先登录百度账号进行授权`);
    } else {
      // 保存现金流变化到百度云盘
      Helpers.Stock.cacheStockFFLows(accessToken, setMsg);
    }
  }, []);
  const generateQData = useCallback(() => {
    if (!accessToken) {
      setMsg(`需要先登录百度账号进行授权`);
    } else {
      // 生成训练数据到百度云盘
      Helpers.Stock.GenerateTrainData(accessToken, dates[0], dates[1], bktype, (m: string) => {
        console.log(m);
        setMsg(m);
      });
    }
  }, [accessToken, dates, bktype]);
  return (
    <div ref={contentRef} className={classnames(styles.content, 'scroll-enabled')}>
      <div className={styles.header}>
        <div>
          <Radio.Group onChange={(e) => setBKType(e.target.value)} value={bktype} size="small" buttonStyle="solid">
            <Radio.Button value={BKType.Industry}>行业</Radio.Button>
            <Radio.Button value={BKType.Gainian}>概念</Radio.Button>
          </Radio.Group>
          &nbsp;
          <DatePicker.RangePicker onChange={setDates} style={{ marginRight: 10 }} size="small" />
          <Button type="link" onClick={doTest}>
            {running ? '进行中...' : '开始回测'}
          </Button>
          <span>{msg}</span>
        </div>

        <div>
          <Button type="text" className={styles.btn} icon={<InteractionOutlined />} onClick={generateQData} />
          <Button type="text" className={styles.btn} icon={<SaveOutlined />} onClick={saveFFlows} />
          <Button type='text' className={styles.btn} icon={<UndoOutlined />} onClick={() => setActions(actions.slice(0, -1))} />
          <Button type="text" className={styles.btn} icon={<PieChartOutlined />} onClick={mayRunGetBK} />
          <Button type="text" className={styles.btn} icon={<RobotOutlined />} />
          <Button type="text" className={styles.btn} icon={<StepForwardOutlined />} onClick={toNextDay} />
          <Select onChange={changeDay} value={activeDay} style={{ width: 120 }} size="small">
            <Select.Option value='none'>选择交易日</Select.Option>
            {Object.keys(bkstats).map((_) => <Select.Option key={_} value={_}>{_}</Select.Option>)}
          </Select>
          <Button
            icon={fullList ? <VerticalAlignBottomOutlined /> : <VerticalAlignTopOutlined />}
            type="text"
            className={styles.btn}
            onClick={() => setFullList(!fullList)}
          />
        </div>
      </div>
      <Tabs activeKey={activeKey} onChange={setActiveKey} style={{ height: fullList ? '0' : '300px', overflow: 'hidden' }}>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>净值表现</span>} key={'perf'}>
          <div ref={chartRef} className={styles.echart} />
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>板块选择</span>} key={'bks'}>
          <Table columns={bkcolumns} dataSource={activeBKStats} pagination={{ defaultPageSize: 20, pageSizeOptions: [20, 50, 100] }} scroll={{ x: 600, y: 180 }} />
          {/* <Table columns={bkcolumns} dataSource={activeBKStats} pagination={{ defaultPageSize: 20, pageSizeOptions: [20, 50, 100] }} scroll={{ x: 600, y: 230 }} /> */}
        </Tabs.TabPane>
        <Tabs.TabPane tab={<span style={{ padding: '0 20px' }}>标的选择</span>} key={'sts'}>
          <Select
            showSearch
            optionFilterProp="children"
            filterOption={(input, option) =>
              (option!.children as unknown as string).toLowerCase().includes(input.toLowerCase())
            } onChange={setActiveBk} value={activeBk} style={{ width: 150, marginRight: 10, marginTop: 5, marginBottom: 5 }}>
            <Select.Option value='none'>请选择</Select.Option>
            {activeBKStats.map((_) => <Select.Option key={_.secid} value={_.secid}>{_.name}</Select.Option>)}
          </Select>
          <Button onClick={mayRunGetST}>个股分析</Button>
          <Button onClick={mayRunAllST}>全局分析</Button>
          <Table columns={stcolumns} dataSource={ststats} pagination={{ defaultPageSize: 50, pageSizeOptions: [50, 100] }} scroll={{ x: 600, y: 150 }} />
        </Tabs.TabPane>
      </Tabs>
      <Row style={{ height: fullList ? '100%' : 'calc(100% - 330px)' }}>
        <Col span={fullWidth ? 0 : 6} style={{ height: '100%' }}>
          <div className={styles.table}>
            <Timeline mode="left" style={{ paddingTop: 10 }}>
              {actions.map((a) => (
                <Timeline.Item key={a.day.format('YYYY-MM-DD')} label={a.day.format('YYYY-MM-DD')}>
                  {a.choosenBks.length > 0 && <div>
                    <b>板块&nbsp;&nbsp;</b>
                    <span>{a.choosenBks.map((_) => _.name).join(', ')}</span>
                    <Button className={styles.btn} type="text" shape="circle" icon={<EyeOutlined />} onClick={() => addMonitors(a.choosenBks.map((_) => _.secid))} /></div>}
                  {a.choosenSts.length > 0 && <div>
                    <b>标的&nbsp;&nbsp;</b>
                    <span>{a.choosenSts.map((_) => _.name).join(', ')}</span>
                    <Button className={styles.btn} type="text" shape="circle" icon={<EyeOutlined />} onClick={() => addMonitors(a.choosenSts.map((_) => _.secid))} /></div>}
                  {a.makeBuys.map((buy) => (
                    <div key={buy.secid}>
                      <b>买入&nbsp;&nbsp;</b>
                      <span>{buy.name}</span>
                      &nbsp;
                      <span>{buy.amount}</span>
                      &nbsp;
                      <span>{buy.price}</span>
                    </div>
                  ))}
                  {a.makeSells.map((sell) => (
                    <div key={sell.secid}>
                      <b>卖出&nbsp;&nbsp;</b>
                      <span>{sell.name}</span>
                      &nbsp;
                      <span>{sell.price}</span>
                      &nbsp;
                      <span>{(sell.profit * 100).toFixed(2)}%</span>
                    </div>
                  ))}
                  {a.holds.map((hold) => (
                    <div key={hold.secid}>
                      <b>持有&nbsp;&nbsp;</b>
                      <span>{hold.name}</span>
                      &nbsp;
                      <span>{(hold.profit * 100).toFixed(2)}%</span>
                    </div>
                  ))}

                  <div>
                    <b>盈亏比&nbsp;&nbsp;</b>{a.wins}/{a.loss}
                  </div>
                  <div>
                    <b>可用资金&nbsp;&nbsp;</b>{a.availableMoney.toFixed(2)}
                  </div>
                  <div><b>总资产&nbsp;&nbsp;</b>{(a.holds.reduce((s, h) => h.amount * h.price * (1 + h.profit) + s, 0.0) + a.availableMoney).toFixed(2)}</div>
                </Timeline.Item>
              ))}
            </Timeline>
          </div>
        </Col>
        <Col span={fullWidth ? 24 : 18} style={{ height: '100%' }}>
          <div className={styles.monitor}>
            <QSTMonitor
              active={active}
              tilDate={activeDay}
              nexDate={nexDay}
              secids={monitors}
              holds={activeAct?.holds || []}
              moveTop={moveMonitoToTop}
              remove={removeMonitor}
              openStock={openStock}
              choosenBks={currentAct?.choosenBks.map((_) => _.secid) || []}
              choosenSts={currentAct?.choosenSts.map((_) => _.secid) || []}
              toggleSelected={toggleSecid}
              doBuy={doBuy}
              doSell={doSell}
              analyzeBK={(bksecid) => runGetST(bksecid, activeDay, setMsg)}
              fullWidth={fullWidth}
              toggleFullWidth={() => setFullWidth(!fullWidth)} />
          </div>

        </Col>
      </Row>
    </div>
  );
});
export default QuantTest;

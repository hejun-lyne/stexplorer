import React, { useCallback, useState, useEffect } from 'react';
import classnames from 'classnames';
import { useSelector, useDispatch } from 'react-redux';
import { InputNumber, Radio, Badge, Switch, Slider, TimePicker, Input, Button, DatePicker, Alert, Modal, message } from 'antd';
import moment from 'moment';
import dayjs from 'dayjs';

import StandCard from '../Card/StandCard';
import CustomDrawerContent from '../CustomDrawer/Content';
import { ReactComponent as SettingIcon } from '@/assets/icons/setting.svg';
import { ReactComponent as DataSourceIcon } from '@/assets/icons/link.svg';
import { ReactComponent as ThemeIcon } from '@/assets/icons/t-shirt.svg';
import { ReactComponent as HintIcon } from '@/assets/icons/notification.svg';
import { defaultSystemSetting } from '@/helpers/setting';
import { setSystemSettingAction } from '@/actions/setting';
import { clearTrainProgressAction, restartTrainAction, resumeTrainAction, saveTrainProgressAction } from '@/actions/train';
import { StoreState } from '@/reducers/types';
import * as Enums from '@/utils/enums';
import styles from './index.scss';
import { saveBaiduTokensAction, clearBaiduTokensAction, loadBaiduTokensAction } from '@/actions/baidu';
import StorageSwitch from '../FullHome/Github/StorageSwitch';

export interface SettingContentProps {
  onClose: () => void;
  onOpenUrl: (url: string) => void;
}

const { shell, app, clipboard, dialog } = window.contextModules.electron;
const { electron, version } = window.contextModules.process;

const SettingContent: React.FC<SettingContentProps> = ({ onClose, onOpenUrl }) => {
  const dispatch = useDispatch();
  const systemSetting = useSelector((state: StoreState) => state.setting.systemSetting);
  const {
    fundApiTypeSetting,
    conciseSetting,
    lowKeySetting,
    baseFontSizeSetting,
    systemThemeSetting,
    adjustmentNotificationSetting,
    adjustmentNotificationTimeSetting,
    trayContentSetting,
    autoStartSetting,
    autoFreshSetting,
    freshDelaySetting,
    ontrain,
    trainStartDate,
    trainEndDate,
    kLineApiSourceSetting,
    kimiApiKeySetting,
    tushareTokenSetting,
    initialCapital,
    commissionRate,
  } = useSelector((state: StoreState) => state.setting.systemSetting);
  // 当前训练会话（交易日列表 / 未完成进度）
  const { days, daysSecid, daysName, progress } = useSelector((state: StoreState) => state.train);
  // 数据来源
  const [fundApiType, setFundApiType] = useState(fundApiTypeSetting);
  // 训练模式
  const [istrain, setIstrain] = useState(ontrain);
  const [trainStart, setTrainStart] = useState(trainStartDate);
  const [trainEnd, setTrainEnd] = useState(trainEndDate);
  const [capital, setCapital] = useState(initialCapital);
  const [commission, setCommission] = useState(commissionRate || defaultSystemSetting.commissionRate);
  const [showResumeModal, setShowResumeModal] = useState(false);
  // 外观设置
  const [concise, setConcise] = useState(conciseSetting);
  const [lowKey, setLowKey] = useState(lowKeySetting);
  const [baseFontSize, setBaseFontSize] = useState(baseFontSizeSetting);
  const [systemTheme, setSystemTheme] = useState(systemThemeSetting);
  // 通知设置
  const [adjustmentNotification, setAdjustmentNotification] = useState(adjustmentNotificationSetting);
  const [adjustmentNotificationTime, setAdjustmentNotifitationTime] = useState(adjustmentNotificationTimeSetting);
  const [trayContent, setTrayContent] = useState(trayContentSetting);
  // 通用设置
  const [autoStart, setAutoStart] = useState(autoStartSetting);
  const [autoFresh, setAutoFresh] = useState(autoFreshSetting);
  const [freshDelay, setFreshDelay] = useState(freshDelaySetting);
  const [kLineApiSource, setKLineApiSource] = useState(kLineApiSourceSetting);
  const [tushareToken, setTushareToken] = useState(tushareTokenSetting);
  const [kimiApiKey, setKimiApiKey] = useState(kimiApiKeySetting);

  function onSave() {
    dispatch(
      setSystemSettingAction({
        fundApiTypeSetting: fundApiType,
        conciseSetting: concise,
        lowKeySetting: lowKey,
        baseFontSizeSetting: baseFontSize,
        systemThemeSetting: systemTheme,
        adjustmentNotificationSetting: adjustmentNotification,
        adjustmentNotificationTimeSetting: adjustmentNotificationTime || defaultSystemSetting.adjustmentNotificationTimeSetting,
        trayContentSetting: trayContent,
        autoStartSetting: autoStart,
        autoFreshSetting: autoFresh,
        freshDelaySetting: freshDelay || defaultSystemSetting.freshDelaySetting,
        ontrain: istrain,
        trainDate: istrain ? trainStart : '',
        trainStartDate: trainStart,
        trainEndDate: trainEnd,
        kLineApiSourceSetting: kLineApiSource,
        tushareTokenSetting: tushareToken,
        kimiApiKeySetting: kimiApiKey,
        initialCapital: capital,
        commissionRate: commission,
      })
    );
  }

  function onCopyGroup(number: string) {
    clipboard.writeText(number);
    dialog.showMessageBox({
      title: '复制成功',
      type: 'info',
      message: `已复制到粘贴板`,
    });
  }

  // 百度网盘 Access Token
  const { accessToken } = useSelector((state: StoreState) => state.baidu);
  const [bdTokenInput, setBdTokenInput] = useState('');
  
  // 加载时读取本地缓存的 token
  useEffect(() => {
    dispatch(loadBaiduTokensAction());
  }, [dispatch]);
  
  // 保存 Access Token
  const handleSaveBaiduToken = useCallback(() => {
    if (!bdTokenInput.trim()) {
      message.warning('请输入 Access Token');
      return;
    }
    dispatch(saveBaiduTokensAction(bdTokenInput.trim()));
    message.success('Access Token 已保存');
    setBdTokenInput('');
  }, [bdTokenInput, dispatch]);
  
  // 清除 Access Token
  const handleClearBaiduToken = useCallback(() => {
    dispatch(clearBaiduTokensAction());
    message.success('Access Token 已清除');
  }, [dispatch]);
  // 训练配置改动后立即生效（详情页的训练工具栏依赖该配置），无需等待“保存”
  const applyTrainSetting = useCallback(
    (patch: Partial<System.Setting>) => {
      dispatch(setSystemSettingAction({ ...systemSetting, ...patch }));
    },
    [systemSetting]
  );

  // 开始训练
  const startTrain = useCallback(() => {
    setIstrain(true);
    applyTrainSetting({
      ontrain: true,
      // 开始时从配置的开始日期起算，具体首个交易日由详情页工具栏校正
      trainDate: trainStart,
      trainStartDate: trainStart,
      trainEndDate: trainEnd,
      initialCapital: capital,
      commissionRate: commission,
    });
    message.success('训练已开始，请在详情页使用训练工具栏');
  }, [applyTrainSetting, trainStart, trainEnd, capital, commission]);

  // 结束训练：未完成则保存进度，下次开启训练时可选择继续
  const stopTrain = useCallback(() => {
    const currentDate = systemSetting.trainDate;
    const lastDay = days.length ? days[days.length - 1] : '';
    const finished = !!lastDay && !!currentDate && currentDate >= lastDay;
    setIstrain(false);
    applyTrainSetting({ ontrain: false });
    if (finished) {
      dispatch(clearTrainProgressAction());
      message.success('训练已结束');
      return;
    }
    dispatch(
      saveTrainProgressAction({
        secid: daysSecid,
        name: daysName,
        startDate: trainStart || systemSetting.trainStartDate,
        endDate: trainEnd || systemSetting.trainEndDate,
        currentDate,
        total: days.length,
        days,
        initialCapital: capital,
        commissionRate: commission,
        savedAt: moment().format('YYYY-MM-DD HH:mm:ss'),
      })
    );
    message.success('训练已暂停并保存进度，下次开启训练时可继续');
  }, [
    applyTrainSetting,
    clearTrainProgressAction,
    saveTrainProgressAction,
    systemSetting.trainDate,
    systemSetting.trainStartDate,
    systemSetting.trainEndDate,
    trainStart,
    trainEnd,
    capital,
    commission,
    days,
    daysSecid,
    daysName,
  ]);

  const onToggleTrain = useCallback(
    (checked: boolean) => {
      if (!checked) {
        stopTrain();
        return;
      }
      if (!trainStart || !trainEnd) {
        message.warning('请先设置训练的开始日期与结束日期');
        return;
      }
      if (moment(trainEnd).isBefore(moment(trainStart))) {
        message.warning('训练结束日期不能早于开始日期');
        return;
      }
      if (!capital || capital <= 0) {
        message.warning('请设置有效的初始资金');
        return;
      }
      // 存在未完成的训练 → 询问继续还是重新开始
      if (progress) {
        setShowResumeModal(true);
        return;
      }
      startTrain();
    },
    [progress, startTrain, stopTrain, trainStart, trainEnd, capital]
  );

  // 继续上一次训练
  const handleResumeTrain = useCallback(() => {
    setShowResumeModal(false);
    setIstrain(true);
    if (progress) {
      setTrainStart(progress.startDate);
      setTrainEnd(progress.endDate);
      setCapital(progress.initialCapital || capital);
      setCommission(progress.commissionRate >= 0 ? progress.commissionRate : commission);
    }
    dispatch(resumeTrainAction());
    message.success('已继续上一次训练');
  }, [progress, capital, commission, dispatch]);

  // 重新开始训练（清除上次进度与模拟买卖记录）
  const handleRestartTrain = useCallback(() => {
    setShowResumeModal(false);
    setIstrain(true);
    dispatch(restartTrainAction());
    message.success('已重新开始训练，上一次训练的模拟买卖记录已清除');
  }, [dispatch]);
  return (
    <CustomDrawerContent title="设置" enterText="保存" onClose={onClose} onEnter={onSave}>
      <style>{` html { font-size: ${baseFontSize}px }`}</style>
      <Modal
        title="发现未完成的训练"
        visible={showResumeModal}
        closable={false}
        maskClosable={false}
        footer={[
          <Button key="cancel" onClick={() => setShowResumeModal(false)}>
            取消
          </Button>,
          <Button key="restart" danger onClick={handleRestartTrain}>
            重新开始
          </Button>,
          <Button key="resume" type="primary" onClick={handleResumeTrain}>
            继续上一次训练
          </Button>,
        ]}
      >
        {progress && (
          <div style={{ lineHeight: 1.9 }}>
            <div>
              训练标的：{progress.name || progress.secid}（{progress.secid}）
            </div>
            <div>
              训练区间：{progress.startDate} ~ {progress.endDate}
            </div>
            <div>
              上次进度：{progress.currentDate}（
              {Math.max(1, progress.days.indexOf(progress.currentDate) + 1)}/{progress.total || progress.days.length} 个交易日）
            </div>
            <div>初始资金：{progress.initialCapital} ｜ 佣金：{(progress.commissionRate * 100).toFixed(4)}%</div>
            <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
              「继续上一次训练」保留上次的模拟持仓与买卖记录；「重新开始」将清除该标的上一次训练的模拟买卖记录，并从当前配置的开始日期重新训练。
            </div>
          </div>
        )}
      </Modal>
      <div className={styles.content}>
        <StandCard icon={<DataSourceIcon />} title="百度云盘">
          <div className={classnames(styles.setting, 'card-body')}>
            <section>
              <label>Access Token：</label>
              {accessToken ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#52c41a' }}>✓ 已配置</span>
                  <Button size="small" onClick={handleClearBaiduToken} danger>
                    清除
                  </Button>
                </div>
              ) : (
                <span style={{ color: '#999' }}>未配置</span>
              )}
            </section>
            <section>
              <Input.Password
                placeholder="输入百度网盘 Access Token"
                value={bdTokenInput}
                onChange={(e) => setBdTokenInput(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button type="primary" onClick={handleSaveBaiduToken} disabled={!bdTokenInput.trim()}>
                保存
              </Button>
            </section>
            <Alert
              message="如何获取 Access Token"
              description={
                <ol style={{ paddingLeft: 16, margin: 0 }}>
                  <li>访问百度网盘开放平台：<a onClick={() => onOpenUrl('https://openapi.baidu.com/oauth/2.0/authorize?response_type=token&client_id=XRUlsAlaWm5XUd4QehFDQihKwhqhOdLq&redirect_uri=oob&scope=netdisk')}>点击获取 Token</a></li>
                  <li>登录百度账号并授权应用</li>
                  <li>授权成功后，从浏览器地址栏复制 access_token 参数值</li>
                  <li>将复制的 Token 粘贴到上方输入框并保存</li>
                </ol>
              }
              type="info"
              showIcon
              style={{ marginTop: 8 }}
            />
          </div>
        </StandCard>
        <StandCard icon={<DataSourceIcon />} title="训练模式">
          <div className={classnames(styles.setting, 'card-body')}>
            <section>
              <label>训练开关：</label>
              <Switch size="small" checked={istrain} onChange={onToggleTrain} />
              <span style={{ marginLeft: 10, fontSize: 12, color: istrain ? '#fa541c' : '#999' }}>
                {istrain ? '训练进行中' : '未开始'}
              </span>
            </section>
            <section>
              <label>开始日期：</label>
              <DatePicker
                size="small"
                value={trainStart ? moment(trainStart) : undefined}
                disabledDate={(c) => !!c && c > moment()}
                onChange={(d) => {
                  const nd = d ? d.format('YYYY-MM-DD') : '';
                  setTrainStart(nd);
                  applyTrainSetting({ trainStartDate: nd });
                }}
                style={{ marginRight: 10 }}
              />
            </section>
            <section>
              <label>结束日期：</label>
              <DatePicker
                size="small"
                value={trainEnd ? moment(trainEnd) : undefined}
                disabledDate={(c) => !!c && c > moment()}
                onChange={(d) => {
                  const nd = d ? d.format('YYYY-MM-DD') : '';
                  setTrainEnd(nd);
                  applyTrainSetting({ trainEndDate: nd });
                }}
                style={{ marginRight: 10 }}
              />
            </section>
            <section>
              <label>初始资金：</label>
              <InputNumber
                size="small"
                min={1000}
                step={10000}
                value={capital}
                onChange={(v) => {
                  const nv = Number(v) || defaultSystemSetting.initialCapital;
                  setCapital(nv);
                  applyTrainSetting({ initialCapital: nv });
                }}
                style={{ width: 140, marginRight: 10 }}
              />
            </section>
            <section>
              <label>交易佣金：</label>
              <InputNumber
                size="small"
                min={0}
                max={5}
                step={0.001}
                precision={4}
                value={Number((commission * 100).toFixed(4))}
                onChange={(v) => {
                  const r = (Number(v) || 0) / 100;
                  setCommission(r);
                  applyTrainSetting({ commissionRate: r });
                }}
                style={{ width: 120 }}
              />
              <span style={{ marginLeft: 6 }}>%（单边，按成交金额收取）</span>
            </section>
            <section>
              <label></label>
              <span style={{ fontSize: 12, color: '#999' }}>
                开启训练后，所有时间序列数据（K线、分时、资金流）都会在数据层按「当前训练日期」截断，网络数据、缓存数据与实时推送都不会出现未来数据；明细页顶部工具栏可按交易日推进（自动跳过非交易日）并模拟买卖。推进到结束日期后提示训练结束，结算并归档后可在左侧栏「训练归档」中查看。以上配置修改即时生效。
              </span>
            </section>
            {progress && !istrain && (
              <section>
                <label></label>
                <span style={{ fontSize: 12, color: '#fa541c' }}>
                  有未完成的训练：{progress.name || progress.secid}，上次进行到 {progress.currentDate}（
                  {Math.max(1, progress.days.indexOf(progress.currentDate) + 1)}/{progress.total || progress.days.length}）—— 再次开启训练时可选择「继续上一次训练」或「重新开始」。
                </span>
              </section>
            )}
          </div>
        </StandCard>
        <StandCard icon={<ThemeIcon />} title="外观设置">
          <div className={classnames(styles.setting, 'card-body')}>
            <section>
              <label>简洁模式：</label>
              <Switch size="small" checked={concise} onChange={setConcise} />
            </section>
            <section>
              <label>低调模式：</label>
              <Switch size="small" checked={lowKey} onChange={setLowKey} />
            </section>
            <section>
              <label>字体大小：</label>
              <Slider min={11} max={14} style={{ flex: 0.5 }} defaultValue={baseFontSize} onChange={setBaseFontSize} step={0.1} />
            </section>
            <section>
              <label>系统主题：</label>
              <Radio.Group
                optionType="button"
                size="small"
                buttonStyle="solid"
                options={[
                  { label: '亮', value: Enums.SystemThemeType.Light },
                  { label: '暗', value: Enums.SystemThemeType.Dark },
                  { label: '自动', value: Enums.SystemThemeType.Auto },
                ]}
                onChange={(e) => setSystemTheme(e.target.value)}
                value={systemTheme}
              />
            </section>
          </div>
        </StandCard>
        <StandCard icon={<HintIcon />} title="通知设置">
          <div className={classnames(styles.setting, 'card-body')}>
            <section>
              <label>调仓提醒：</label>
              <Switch size="small" checked={adjustmentNotification} onChange={setAdjustmentNotification} />
            </section>
            <section>
              <label>提醒时间：</label>
              <TimePicker
                disabled={!adjustmentNotification}
                allowClear={false}
                size="small"
                value={moment(dayjs(adjustmentNotificationTime).format('HH:mm:ss'))}
                onChange={(v) => setAdjustmentNotifitationTime(v!.format('HH:mm:ss'))}
                format="HH:mm"
              />
            </section>
            <section>
              <label>托盘内容：</label>
              <Radio.Group
                optionType="button"
                size="small"
                buttonStyle="solid"
                options={[
                  { label: '收益', value: Enums.TrayContent.Sy },
                  { label: '收益率', value: Enums.TrayContent.Syl },
                  { label: '无', value: Enums.TrayContent.None },
                ]}
                onChange={(e) => setTrayContent(e.target.value)}
                value={trayContent}
              />
            </section>
          </div>
        </StandCard>
        <StandCard icon={<SettingIcon />} title="系统设置">
          <div className={classnames(styles.setting, 'card-body')}>
            <section>
              <label>开机自启：</label>
              <Switch size="small" checked={autoStart} onChange={setAutoStart} />
            </section>
            <section>
              <label>自动刷新：</label>
              <Switch size="small" checked={autoFresh} onChange={setAutoFresh} />
            </section>
            <section>
              <label>刷新间隔：</label>
              <InputNumber
                disabled={!autoFresh}
                value={freshDelay}
                onChange={setFreshDelay}
                placeholder="1~60分钟"
                precision={0}
                min={1}
                max={60}
                size="small"
              />
            </section>
          </div>
        </StandCard>
        <StandCard icon={<SettingIcon />} title="数据来源">
          <div className={classnames(styles.setting, 'card-body')}>
            <section>
              <label>K线数据源：</label>
              <Radio.Group
                optionType="button"
                size="small"
                buttonStyle="solid"
                options={[
                  { label: '东财', value: Enums.FundApiType.Eastmoney },
                  { label: 'XTick', value: Enums.FundApiType.XTick },
                  { label: 'ZiZai', value: Enums.FundApiType.ZiZai },
                  { label: 'Akshare', value: Enums.FundApiType.Akshare },
                  { label: 'Tushare', value: Enums.FundApiType.Tushare },
                ]}
                onChange={(e) => setKLineApiSource(e.target.value)}
                value={kLineApiSource}
              />
            </section>
            <section>
              <label>Tushare Token：</label>
              <Input.Password
                value={tushareToken}
                onChange={(e) => setTushareToken(e.target.value)}
                placeholder="在 tushare.pro 注册获取"
                size="small"
                style={{ flex: 1 }}
              />
            </section>
            <section>
              <label></label>
              <span style={{ fontSize: 12, color: '#999' }}>
                在 <a onClick={() => onOpenUrl('https://tushare.pro/register')}>Tushare Pro</a> 注册获取 Token，6000 积分可调用大部分接口
              </span>
            </section>
          </div>
        </StandCard>
        <StandCard icon={<SettingIcon />} title="AI 分析">
          <div className={classnames(styles.setting, 'card-body')}>
            <section>
              <label>Kimi API Key：</label>
              <Input.Password
                value={kimiApiKey}
                onChange={(e) => setKimiApiKey(e.target.value)}
                placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                size="small"
                style={{ flex: 1 }}
              />
            </section>
            <section>
              <label></label>
              <span style={{ fontSize: 12, color: '#999' }}>
                在 <a onClick={() => onOpenUrl('https://platform.moonshot.cn/console/account')}>Kimi 开放平台</a> 获取 API Key
              </span>
            </section>
          </div>
        </StandCard>
        <StorageSwitch />
      </div>
      <div className={styles.exit}>
        <button type="button" onClick={() => app.quit()}>
          退出程序
        </button>
      </div>
      <div className={styles.version}>
        <div>Based on Electron v{electron}</div>
      </div>
    </CustomDrawerContent>
  );
};

export default SettingContent;

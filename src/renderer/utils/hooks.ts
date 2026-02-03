import { useCallback, useLayoutEffect, useState, useEffect, useRef } from 'react';
import { useInterval, useBoolean, useSize } from 'ahooks';
import { useDispatch, useSelector } from 'react-redux';
import { compose } from 'redux';
import { Base64 } from 'js-base64';
import * as echarts from 'echarts';
import { updateStockAction } from '@/actions/stock';
import { StoreState } from '@/reducers/types';
import * as Utils from '@/utils';
import * as CONST from '@/constants';
import * as Adapters from '@/utils/adapters';
import * as Services from '@/services';
import * as Helpers from '@/helpers';
import * as Enums from '@/utils/enums';
import { initGithubInfo } from '@/actions/github';
import { Stock } from '@/types/stock';
import { loadBaiduTokensAction } from '@/actions/baidu';
import { monaco } from '@monaco-editor/react';

const { invoke, dialog, ipcRenderer, app, saveString, encodeFF, decodeFF, readFile } = window.contextModules.electron;

export function useWorkDayTimeToDo(todo: () => void, delay: number | undefined | null): void {
  useInterval(async () => {
    const timestamp = new Date().getTime();
    const isWorkDayTime = Utils.JudgeWorkDayTime(Number(timestamp));
    if (isWorkDayTime) {
      todo();
    }
  }, delay);
}

export function useUSWorkDayTimeToDo(todo: () => void, delay: number | undefined | null): void {
  useInterval(async () => {
    const timestamp = new Date().getTime();
    const isWorkDayTime = Utils.JudgeUSWorkDayTime(Number(timestamp));
    if (isWorkDayTime) {
      todo();
    }
  }, delay);
}

export function useFixTimeToDo(todo: () => void, delay: number, config?: { immediate: boolean }): void {
  useInterval(
    async () => {
      const timestamp = await Helpers.Time.GetCurrentHours();
      const isFixTime = Utils.JudgeFixTime(Number(timestamp));
      if (isFixTime) {
        todo();
      }
    },
    delay,
    config
  );
}

export function useScrollToTop(
  config: {
    before?: () => void | Promise<void>;
    after?: () => void | Promise<void>;
    option?: {
      behavior?: ScrollBehavior;
      left?: number;
      top?: number;
    };
  },
  dep: any[] = []
) {
  return useCallback(async () => {
    const { before, after, option } = config;
    if (before) {
      await before();
    }
    window.scrollTo({
      behavior: 'smooth',
      top: 0,
      ...option,
    });
    if (after) {
      await after();
    }
  }, dep);
}

export function useTrayContent() {
  const { trayContentSetting } = useSelector((state: StoreState) => state.setting.systemSetting);

  useEffect(() => {
    let content = '';
    switch (trayContentSetting) {
      case Enums.TrayContent.Sy:
        content = ` ${Utils.Yang(0.0)} ¥`;
        break;
      case Enums.TrayContent.Syl:
        content = ` ${Utils.Yang(0.0)} %`;
        break;
      case Enums.TrayContent.None:
      default:
        break;
    }
    ipcRenderer.invoke('set-tray-content', content);
  }, [trayContentSetting]);
}

export function useAllConfigBackup() {
  useLayoutEffect(() => {
    ipcRenderer.on('backup-all-config-export', async (e, data) => {
      try {
        const backupConfig = Utils.GenerateBackupConfig();
        const { filePath, canceled } = await dialog.showSaveDialog({
          title: '保存',
          defaultPath: `${backupConfig.name}-${backupConfig.timestamp}.${backupConfig.suffix}`,
        });
        if (canceled) {
          return;
        }

        const encodeBackupConfig = compose(Base64.encode, encodeFF)(backupConfig);
        saveString(filePath!, encodeBackupConfig);
        dialog.showMessageBox({
          type: 'info',
          title: '导出成功',
          message: `已到处全局配置文件至${filePath}`,
        });
      } catch (error) {
        dialog.showMessageBox({
          type: 'info',
          title: `导出失败`,
          message: `导出全局配置文件失败`,
        });
        console.log('导出全局配置文件失败', error);
      }
    });
    ipcRenderer.on('backup-all-config-import', async (e, data) => {
      try {
        const { filePaths, canceled } = await dialog.showOpenDialog({
          title: '选择备份文件',
          filters: [{ name: 'My-Quantization', extensions: ['mq'] }],
        });
        const filePath = filePaths[0];
        if (canceled || !filePath) {
          return;
        }
        const encodeBackupConfig = readFile(filePath);
        const backupConfig: Backup.Config = compose(decodeFF, Base64.decode)(encodeBackupConfig);
        Utils.coverBackupConfig(backupConfig);
        await dialog.showMessageBox({
          type: 'info',
          title: `导入成功`,
          message: `导入全局配置成功, 请重新启动`,
        });
        app.quit();
      } catch (error) {
        dialog.showMessageBox({
          type: 'info',
          title: `导入失败`,
          message: `导入全局配置文件失败`,
        });
        console.log('导入全局配置文件失败', error);
      }
    });

    return () => {
      ipcRenderer.offAll('back-all-config-export');
      ipcRenderer.offAll('back-all-config-import');
    };
  }, []);
}

export function useNativeTheme() {
  const [darkMode, setDarkMode] = useState(false);
  const systemSetting = useSelector((state: StoreState) => state.setting.systemSetting);
  const { systemThemeSetting } = systemSetting;
  async function syncSystemTheme() {
    await Utils.UpdateSystemTheme(systemThemeSetting);
    await invoke.getShouldUseDarkColors().then(setDarkMode);
  }

  useLayoutEffect(() => {
    ipcRenderer.on('nativeTheme-updated', (e, data) => {
      setDarkMode(!!data?.darkMode);
    });
    return () => {
      ipcRenderer.offAll('nativeTheme-updated');
    };
  }, []);

  useEffect(() => {
    syncSystemTheme();
  }, [systemThemeSetting]);

  return { darkMode };
}

export function useNativeThemeColor(variables: string[]) {
  const { darkMode } = useNativeTheme();
  const lowKeySetting = useSelector((state: StoreState) => state.setting.systemSetting.lowKeySetting);
  const [colors, setColors] = useState<any>({});

  useEffect(() => {
    setColors(Utils.getVariablesColor(variables));
  }, [darkMode, lowKeySetting]);

  return { lowKey: lowKeySetting, darkMode, colors };
}

export function useResizeEchart(
  scale = 1,
  onZoom?: (e: any) => void,
  onMouseClick?: (e: any) => void,
  onBrushEnded?: (e: any) => void,
  onBrushSelected?: (e: any) => void,
  onMouseDbClick?: (e: any) => void,
  onMouseMove?: (e: any) => void,
  onMouseOver?: (e: any) => void,
  onMouseOut?: (e: any) => void
) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartInstance, setChartInstance] = useState<echarts.ECharts | null>(null);
  const { width: chartRefWidth, height: chartRefHeight } = useSize(chartRef);
  useEffect(() => {
    const instance = echarts.init(chartRef.current!, undefined, {
      renderer: 'svg',
    });
    if (onZoom) {
      instance.on('datazoom', onZoom);
    }
    if (onMouseClick) {
      instance.on('click', onMouseClick);
    }
    if (onMouseDbClick) {
      instance.getZr().on('dblclick', onMouseDbClick);
    }
    if (onMouseMove) {
      instance.on('mousemove', onMouseMove);
    }
    if (onMouseOver) {
      instance.on('mouseover', onMouseOver);
    }
    if (onMouseOut) {
      instance.on('mouseout', onMouseOut);
    }
    if (onBrushEnded) {
      instance.on('brushEnd', onBrushEnded);
    }
    if (onBrushSelected) {
      instance.on('brushselected', onBrushSelected);
    }
    setChartInstance(instance);

    return () => {
      instance.off('datazoom');
      instance.off('click');
      instance.off('brushEnd');
      instance.off('brushselected');
      instance.getZr().off('dblclick');
      instance.off('mousemove');
      instance.off('mouseover');
      instance.off('mouseout');
    };
  }, [onMouseClick, onBrushSelected, onBrushEnded]);
  useEffect(() => {
    console.log('chartResize', chartRefWidth, chartRefHeight);
    if (
      chartRefWidth &&
      chartRefWidth > 0 &&
      (chartInstance?.getWidth() != chartRefWidth || chartInstance?.getHeight() != chartRefHeight)
    ) {
      console.log('will resize chart');
      if (scale < 0) {
        chartInstance?.resize({ width: chartRefWidth, height: chartRefHeight || chartRefWidth });
      } else {
        chartInstance?.resize({ height: chartRefWidth! * scale });
      }
    }
  }, [chartRefWidth, chartRefHeight, scale, chartInstance]);
  return { ref: chartRef, chartRefWidth, chartInstance, setChartInstance };
}

export function useRenderEcharts(callback: () => void, instance: echarts.ECharts | null, dep: any[] = []) {
  useEffect(() => {
    if (instance) {
      callback();
    }
  }, [instance, ...dep]);
}

export function useSyncFixStockSetting() {
  const dispatch = useDispatch();
  const [done, { setTrue }] = useBoolean(false);
  const { stockConfigs } = useSelector((state: StoreState) => state.stock);
  async function FixStockSetting(stockConfig: Stock.SettingItem[]) {
    try {
      const collectors = stockConfig.map(
        ({ name, code, secid }) =>
          () =>
            Services.Stock.SearchFromEastmoney(name).then((searchResult) => {
              searchResult?.forEach(({ Datas, Type }) => {
                Datas.forEach(({ Code }) => {
                  if (Code == code) {
                    dispatch(
                      updateStockAction({
                        secid,
                        type: Type,
                      })
                    );
                  }
                });
              });
              return searchResult;
            })
      );
      await Adapters.ChokeAllAdapter(collectors, 100);
    } catch (error) {
      console.log(error);
    } finally {
      setTrue();
    }
  }
  useEffect(() => {
    const unTypedStocks = stockConfigs.filter(({ type }) => !type);
    if (unTypedStocks.length) {
      FixStockSetting(unTypedStocks);
    } else {
      setTrue();
    }
  }, [stockConfigs]);

  return { done };
}

export function useDrawer<T>(initialData: T) {
  const [drawer, setDrawer] = useState({
    data: initialData,
    show: false,
  });
  return {
    data: drawer.data,
    show: drawer.show,
    set: (data: T) => {
      setDrawer({ show: true, data });
    },
    close: () => {
      setDrawer({ show: false, data: initialData });
    },
  };
}

export function useAdjustmentNotification() {
  const systemSetting = useSelector((state: StoreState) => state.setting.systemSetting);
  const { adjustmentNotificationSetting, adjustmentNotificationTimeSetting } = systemSetting;
  useInterval(
    async () => {
      if (!adjustmentNotificationSetting) {
        return;
      }
      const timestamp = await Helpers.Time.GetCurrentHours();
      const { isAdjustmentNotificationTime, now } = Utils.JudgeAdjustmentNotificationTime(
        Number(timestamp),
        adjustmentNotificationTimeSetting
      );
      const month = now.get('month');
      const date = now.get('date');
      const hour = now.get('hour');
      const minute = now.get('minute');
      const currentDate = `${month}-${date}`;
      const lastNotificationDate = Utils.GetStorage(CONST.STORAGE.ADJUSTMENT_NOTIFICATION_DATE, '');
      if (isAdjustmentNotificationTime && currentDate !== lastNotificationDate) {
        const notification = new Notification('调仓提醒', {
          body: `当前时间${hour}:${minute} 注意行情走势`,
        });
        notification.onclick = () => {
          invoke.showCurrentWindow();
        };
        Utils.SetStorage(CONST.STORAGE.ADJUSTMENT_NOTIFICATION_DATE, currentDate);
      }
    },
    1000 * 50,
    {
      immediate: true,
    }
  );
}

/**
 * 启动之后执行定时任务
 */
export function useBootStrap() {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch(initGithubInfo());
    dispatch(loadBaiduTokensAction());

    // Monaco
    defineMonacoThemes('krTheme');
    // defineMonacoThemes('light');
  }, []);
}

export function useMappingLocalToSystemSetting() {
  const systemThemeSetting = useSelector((state: StoreState) => state.setting.systemSetting.systemThemeSetting);
  const autoStartSetting = useSelector((state: StoreState) => state.setting.systemSetting.autoStartSetting);
  const lowKeySetting = useSelector((state: StoreState) => state.setting.systemSetting.lowKeySetting);
  const adjustmentNotificationTimeSetting = useSelector(
    (state: StoreState) => state.setting.systemSetting.adjustmentNotificationTimeSetting
  );
  useLayoutEffect(() => {
    Utils.UpdateSystemTheme(systemThemeSetting);
  }, [systemThemeSetting]);
  useLayoutEffect(() => {
    app.setLoginItemSettings({ openAtLogin: autoStartSetting });
  }, [autoStartSetting]);
  useLayoutEffect(() => {
    if (lowKeySetting) {
      document.body.classList.add('lowKey');
    } else {
      document.body.classList.remove('lowKey');
    }
  }, [lowKeySetting]);
  useAfterMounted(() => {
    Utils.ClearStorage(CONST.STORAGE.ADJUSTMENT_NOTIFICATION_DATE);
  }, [adjustmentNotificationTimeSetting]);
}

export function useAfterMounted(fn: any, dep: any[] = []) {
  const [flag, { setTrue }] = useBoolean(false);
  useEffect(() => {
    setTrue();
  }, []);
  useLayoutEffect(() => {
    if (flag) {
      fn();
    }
  }, [flag, ...dep]);
}

export function useContextMenu(options: { onAddNote?: (url: string, text: string) => void; onAddStock?: (text: string) => void }) {
  useLayoutEffect(() => {
    if (options.onAddNote) {
      ipcRenderer.on('add-note', (e, data) => {
        options.onAddNote!(data.url, data.text);
      });
    }
    if (options.onAddStock) {
      ipcRenderer.on('add-stock', (e, data) => {
        options.onAddStock!(data.text);
      });
    }
    return () => {
      if (options.onAddNote) ipcRenderer.offAll('add-note');
      if (options.onAddStock) ipcRenderer.offAll('add-stock');
    };
  }, []);
}

export function useShortcut(options: { onCloseCurrentTab?: () => void }) {
  useLayoutEffect(() => {
    console.log('bind close-current-tab');
    ipcRenderer.offAll('close-current-tab');
    ipcRenderer.on('close-current-tab', (e, data) => {
      if (options.onCloseCurrentTab) {
        options.onCloseCurrentTab();
      }
    });
    return () => {
      ipcRenderer.offAll('close-current-tab');
    };
  }, []);
}

function defineMonacoThemes(theme: string) {
  monaco.init().then((m) => {
    if (m) {
      import(`monaco-themes/themes/${theme}.json`).then((data) => {
        if (data) {
          m.editor.defineTheme(theme, data);
        }
        return data;
      }).catch(e => {
        console.log(e);
      });
    }
    return m;
  });
}

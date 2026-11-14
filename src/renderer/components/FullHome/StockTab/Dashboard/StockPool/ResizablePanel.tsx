import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import * as Utils from '@/utils';

/** 收起后只剩的窄条宽度 */
export const PANEL_RAIL_WIDTH = 18;
/** 分隔线拖动区宽度（内容区也要留出同样的左内边距） */
export const PANEL_HANDLE_WIDTH = 18;
/** 面板可拖到的最小宽度 */
const PANEL_MIN_WIDTH = 320;
/** 宽度拖到此值以下即视为收起 */
const PANEL_COLLAPSE_THRESHOLD = 120;
/** 左侧结果列表至少保留的宽度 */
const PANEL_MIN_LIST_WIDTH = 360;

/**
 * 右侧面板「拖动调整宽度 / 收起展开」的共享实现。
 *
 * 与 STList 的 ScoreStockPanel 完全同口径：向左拖变宽、向右拖变窄、拖到最右侧收起，
 * 收起后仍可继续向左拖展开；宽度与收起状态按 storageKeyPrefix 分开持久化，
 * 两个列表各用各的键，互不干扰。
 */
export function useResizablePanel(storageKeyPrefix: string) {
  const widthKey = `${storageKeyPrefix}Width`;
  const collapsedKey = `${storageKeyPrefix}Collapsed`;
  const rootRef = useRef<HTMLDivElement>(null);
  /** 展开宽度（null = 默认与左侧列表平分） */
  const [width, setWidth] = useState<number | null>(() => {
    const saved = Number(Utils.GetStorage(widthKey, 0));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  });
  const [collapsed, setCollapsed] = useState<boolean>(
    () => Utils.GetStorage<boolean>(collapsedKey, false) === true
  );
  /** 最近一次拖动到的展开宽度（收起时保留它，展开就回到这个位置） */
  const lastWidthRef = useRef<number | null>(width);
  /** 本次按下是否发生了拖动：拖动后松开产生的 click 不再当成「切换收起」 */
  const dragMovedRef = useRef(false);
  /** 拖动中挂载的全局监听清理函数（组件卸载时兜底） */
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    []
  );

  const applyCollapsed = useCallback(
    (next: boolean) => {
      setCollapsed(next);
      Utils.SetStorage(collapsedKey, next);
    },
    [collapsedKey]
  );
  const expand = useCallback(() => applyCollapsed(false), [applyCollapsed]);

  /** 面板最大宽度：给左侧结果列表留出可读空间（容器还没布局时返回 0，避免误夹紧） */
  const maxPanelWidth = useCallback(() => {
    const parent = rootRef.current?.parentElement;
    const total = parent ? parent.getBoundingClientRect().width : 0;
    if (!total) {
      return 0;
    }
    return Math.max(PANEL_MIN_WIDTH, total - PANEL_MIN_LIST_WIDTH);
  }, []);

  // 记住的宽度超过当前可用空间时（窗口变小 / 换屏幕）拉回来，避免把左侧列表挤没
  useEffect(() => {
    if (width == null) {
      return;
    }
    const max = maxPanelWidth();
    if (max > 0 && width > max) {
      setWidth(max);
    }
  }, [width, maxPanelWidth]);

  useEffect(() => {
    const onResize = () => {
      const max = maxPanelWidth();
      if (!max) {
        return;
      }
      setWidth((w) => (w == null ? w : Math.min(Math.max(w, PANEL_MIN_WIDTH), max)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [maxPanelWidth]);

  /**
   * 拖动分隔线调整宽度：向左拖变宽、向右拖变窄；宽度小于阈值即收起。
   * 收起后仍可继续向左拖，一离开阈值就重新展开。
   */
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) {
        return;
      }
      // 阻止拖拽时选中文字；按钮自己的 click 仍会正常触发
      e.preventDefault();
      dragMovedRef.current = false;
      const startX = e.clientX;
      const startWidth = collapsed ? PANEL_RAIL_WIDTH : rootRef.current?.getBoundingClientRect().width || 0;
      /** 拖动前的展开宽度：拖到最右侧收起时，展开仍回到这个位置 */
      const preDragWidth = collapsed ? 0 : Math.round(startWidth);
      const maxW = maxPanelWidth() || Math.max(PANEL_MIN_WIDTH, window.innerWidth - PANEL_MIN_LIST_WIDTH);
      let isCollapsedNow = collapsed;
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        const dx = startX - ev.clientX;
        if (Math.abs(dx) > 2) {
          dragMovedRef.current = true;
        }
        const next = startWidth + dx;
        if (next < PANEL_COLLAPSE_THRESHOLD) {
          if (!isCollapsedNow) {
            isCollapsedNow = true;
            applyCollapsed(true);
          }
          return;
        }
        const clamped = Math.min(Math.max(next, PANEL_MIN_WIDTH), maxW);
        lastWidthRef.current = clamped;
        if (isCollapsedNow) {
          isCollapsedNow = false;
          applyCollapsed(false);
        }
        setWidth(clamped);
      };

      const cleanup = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = prevUserSelect;
        dragCleanupRef.current = null;
      };

      const onUp = () => {
        cleanup();
        // 记住最后停留的位置：下次展开就是这里（纯点击不落盘）。
        if (dragMovedRef.current) {
          const restore = (isCollapsedNow ? preDragWidth : lastWidthRef.current) || 0;
          if (restore > 0) {
            lastWidthRef.current = restore;
            Utils.SetStorage(widthKey, restore);
          }
        }
        // click 事件在本轮事件循环里紧跟着触发，用定时器复位让这次的 click 被忽略
        window.setTimeout(() => {
          dragMovedRef.current = false;
        }, 0);
      };

      dragCleanupRef.current = cleanup;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [collapsed, maxPanelWidth, applyCollapsed, widthKey]
  );

  /** 分隔线中间的收起 / 展开按钮 */
  const handleToggleClick = useCallback(() => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    applyCollapsed(!collapsed);
  }, [collapsed, applyCollapsed]);

  const rootStyle: React.CSSProperties = {
    position: 'relative',
    display: 'flex',
    height: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    borderLeft: '1px solid var(--border-color)',
    // 收起 = 只剩最右侧一条窄边；展开 = 用户最后拖动的位置（没拖过则与列表平分）
    flex: collapsed ? `0 0 ${PANEL_RAIL_WIDTH}px` : width != null ? `0 0 ${width}px` : '1 1 50%',
  };

  return { rootRef, rootStyle, collapsed, expand, startResize, handleToggleClick };
}

/** 竖直分隔线：按住拖动改宽度，中间小按钮点击收起 / 展开 */
export const PanelResizeHandle: React.FC<{
  collapsed: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onToggle: () => void;
}> = ({ collapsed, onMouseDown, onToggle }) => (
  <div
    onMouseDown={onMouseDown}
    style={{
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: PANEL_HANDLE_WIDTH,
      zIndex: 20,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: collapsed ? 'pointer' : 'col-resize',
    }}
    title={collapsed ? '点击展开面板，或按住向左拖动展开' : '拖动调整面板宽度；拖到最右侧即收起'}
  >
    <div
      onClick={onToggle}
      title={collapsed ? '展开面板' : '收起面板'}
      style={{
        width: 16,
        height: 46,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--inner-color)',
        border: '1px solid var(--border-color)',
        borderRadius: 4,
        cursor: 'pointer',
        color: 'var(--secondary-text-color)',
        fontSize: 10,
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.18)',
        userSelect: 'none',
      }}
    >
      {collapsed ? <LeftOutlined /> : <RightOutlined />}
    </div>
  </div>
);

/**
 * 可直接包裹右侧面板内容的容器：自带拖动分隔线、收起/展开与宽度记忆。
 *
 * `expandSignal` 在面板已挂载期间变化时自动展开：例如点列表行切换图表对象时，
 * 用户不需要先手动点一下展开按钮才能看到新内容。挂载时的初始值不触发展开，
 * 以便保留上次持久化的收起状态（与 STList 一致）。
 */
export const ResizableSidePanel: React.FC<{
  storageKey: string;
  children: React.ReactNode;
  expandSignal?: number;
}> = ({ storageKey, children, expandSignal }) => {
  const { rootRef, rootStyle, collapsed, expand, startResize, handleToggleClick } = useResizablePanel(storageKey);
  const lastSignalRef = useRef(expandSignal);
  useEffect(() => {
    if (lastSignalRef.current === expandSignal) {
      return;
    }
    lastSignalRef.current = expandSignal;
    expand();
  }, [expandSignal, expand]);

  return (
    <div ref={rootRef} style={rootStyle}>
      <PanelResizeHandle collapsed={collapsed} onMouseDown={startResize} onToggle={handleToggleClick} />
      {!collapsed ? (
        <div
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            height: '100%',
            display: 'flex',
            paddingLeft: PANEL_HANDLE_WIDTH,
            boxSizing: 'border-box',
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
};

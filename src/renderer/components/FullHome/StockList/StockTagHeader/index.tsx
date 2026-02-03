import React from 'react';
import { useDispatch } from 'react-redux';
import { Dropdown, Menu } from 'antd';
import * as Utils from '@/utils';
import { StockMarketType } from '@/utils/enums';
import { useHomeContext } from '@/components/FullHome';

export interface StockTagHeaderProps {
    mtype: StockMarketType;
    name: string;
    zdf: number;
    onTagViewAll: (tag: string, markettype: StockMarketType) => void;
}

const StockTagHeader: React.FC<StockTagHeaderProps> = React.memo(({ mtype, name, zdf, onTagViewAll }) => {
    const { darkMode } = useHomeContext(); 
    const dispatch = useDispatch();
    const onContextMenu = (e) => {
        switch (e.key) {
        case 'viewall':
            onTagViewAll(name);
            break;
        default:
            break;
        }
    };
    const menu = (
        <Menu onClick={onContextMenu} theme={darkMode ? 'dark' : 'light'}>
        <Menu.Item key="viewall" danger={true}>
            查看所有
        </Menu.Item>
        </Menu>
    );
    return (
        <Dropdown overlay={menu} trigger={['contextMenu']}>
            <div>
            <span>{name}</span>
            &nbsp;
            <span className={Utils.GetValueColor(zdf).textClass}>{zdf.toFixed(2)}%</span>
            </div>
        </Dropdown>
    );
});
export default StockTagHeader;

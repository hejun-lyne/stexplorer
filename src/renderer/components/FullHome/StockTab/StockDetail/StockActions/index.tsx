import React, { useState } from 'react';
import classnames from 'classnames';
import PureCard from '@/components/Card/PureCard';
import * as Utils from '@/utils';
import { useEffect } from 'react';
import styles from './index.scss';
import { Stock } from '@/types/stock';

export interface StockActionsProps {
  secid: string;
}

const StockActions: React.FC<StockActionsProps> = ({ secid }) => {
  return (
    <PureCard>
      <div className={styles.container}>
        
      </div>
    </PureCard>
  );
};

export default StockActions;

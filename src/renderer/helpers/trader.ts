import { Stock } from '@/types/stock';

export class Trader {
  availableAmount: number;

  totalAmount: number;

  commission: number;

  maxHold: number;

  currentDate?: string;

  currentStock?: Stock.DetailItem;

  shares: Strategy.BackTestHold[];

  tradings: Strategy.BackTestTrading[];

  onDeal: (deal: Strategy.BackTestTrading) => void;

  constructor() {
    this.availableAmount = 100000;
    this.totalAmount = 100000;
    this.commission = 0.03;
    this.maxHold = 10;
    this.shares = [];
    this.tradings = [];
    this.onDeal = (d) => { };
  }

  init(initialAmount: number, commission: number, maxHold: number) {
    this.availableAmount = initialAmount;
    this.totalAmount = initialAmount;
    this.commission = commission;
    this.maxHold = maxHold;
  }

  pack() {
    return {
      date: this.currentDate,
      availableAmount: this.availableAmount,
      totalAmount: this.totalAmount,
      shares: this.shares,
      trading: this.tradings,
    };
  }

  onTradeDay(date: string, stock: Stock.DetailItem, dayKline: Stock.KLineItem) {
    if (!stock) {
      this.currentDate = date;
      return;
    }
    console.log('onTradeDay: ' + date + ', ' + stock.name);
    this.currentDate = date;
    this.currentStock = stock;
    const hold = this.shares.find((h) => h.secid == this.currentStock?.secid);
    if (hold) {
      hold.lastSp = dayKline.sp;
      hold.amount = hold.lastSp * hold.count;
      let total = 0;
      for (let i = 0; i < this.shares.length; i++) {
        total += this.shares[i].amount;
      }
      this.totalAmount = total + this.availableAmount;
    }
  }

  buy(price: number, count: number) {
    if (!this.currentDate || !this.currentStock) {
      console.log('please call onTradeDate first!');
      return;
    }
    if (count < 100) {
      console.log('invalid count!');
      return;
    }
    if (this.maxHold <= this.shares.length) {
      console.log('reach maxHold!');
      return;
    }
    const cost = price * count;
    if (this.availableAmount <= cost * (1 + this.commission)) {
      console.log('not enough momey, ' + this.availableAmount);
      console.log('current holds: ' + JSON.stringify(this.shares));
      return;
    }
    const newTrade = {
      date: this.currentDate,
      secid: this.currentStock.secid,
      name: this.currentStock.name,
      price,
      count,
      amount: price * count,
      type: 'buy',
    };
    this.tradings.push(newTrade);
    console.log('doBuy', JSON.stringify(newTrade));
    this.onDeal(newTrade);
    const hold = this.shares.find((h) => h.secid == this.currentStock?.secid);
    if (!hold) {
      this.shares.push({
        secid: this.currentStock.secid,
        name: this.currentStock.name,
        avgPrice: price,
        count,
        amount: price * count,
        lastSp: price,
        lastDate: this.currentDate,
      });
    } else {
      const totalCost = hold.avgPrice * hold.count + cost;
      const totalCount = hold.count + count;
      const avgPrice = totalCost / totalCount;
      hold.count = totalCount;
      hold.avgPrice = avgPrice;
      hold.amount = hold.amount + cost;
    }
    this.availableAmount -= cost * (1 + this.commission);
  }

  sell(price: number, count: number) {
    if (!this.currentDate || !this.currentStock) {
      console.log('please call onTradeDate first!');
      return;
    }
    const hold = this.shares.find((h) => h.secid == this.currentStock?.secid);
    if (hold) {
      if (this.currentDate.substring(0, 10) == hold.lastDate.substring(0, 10)) {
        console.log('cant sell on  same day!');
        return;
      }
      const newTrade = {
        date: this.currentDate,
        secid: this.currentStock.secid,
        name: this.currentStock.name,
        price,
        count,
        amount: price * count,
        type: 'sell',
      };
      this.tradings.push(newTrade);
      console.log('doSell', JSON.stringify(newTrade));
      this.onDeal(newTrade);
      const revenue = price * count;
      const totalCost = hold.avgPrice * hold.count - revenue;
      const totalCount = hold.count - count;
      const avgPrice = totalCount == 0 ? 0 : totalCost / totalCount;
      hold.count = totalCount;
      hold.avgPrice = avgPrice;
      hold.amount = hold.amount - revenue;
      this.availableAmount += revenue * (1 - this.commission);
      if (totalCount == 0) {
        this.shares = this.shares.filter((h) => h.secid != this.currentStock?.secid);
      }
    } else {
      console.log('no holdings');
    }
  }
}

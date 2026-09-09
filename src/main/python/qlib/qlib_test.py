import qlib
from qlib.constant import REG_CN

# 初始化 Qlib，指定数据路径
provider_uri = "~/.qlib/qlib_data/cn_data"
qlib.init(provider_uri=provider_uri, region=REG_CN)

# 2. 获取交易日历  
from qlib.data import D  
print("前两个交易日：")  
print(D.calendar(start_time='2010-01-01', end_time='2017-12-31', freq='day')[:2])  
# 输出: [Timestamp('2010-01-04'), Timestamp('2010-01-05')]  
  
# 3. 解析股票池  
print("\nA股全部股票池配置：")  
print(D.instruments(market='all'))  
# 输出: {'market': 'all', 'filter_pipe': []}  
  
# 4. 列出沪深300成分股（2010-2017）  
instruments = D.instruments(market='csi300')  
print("\n沪深300前6只：")  
print(D.list_instruments(instruments=instruments,  
                         start_time='2010-01-01',  
                         end_time='2017-12-31',  
                         as_list=True)[:6])  
# 输出: ['SH600036', 'SH600110', 'SH600087', 'SH600900', 'SH600089', 'SZ000912']  
  
# 5. 取特征数据  
instruments = ['SH600000']  
fields = ['$close', '$volume', 'Ref($close, 1)', 'Mean($close, 3)', '$high-$low']  
df = D.features(instruments, fields,  
                start_time='2010-01-01', end_time='2017-12-31', freq='day')  
print("\nSH600000 前5行：")  
print(df.head())

from __future__ import print_function
import argparse
from turtle import forward
import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim
from torchvision import datasets, transforms
from torch.optim.lr_scheduler import StepLR
from torch.utils.data import Dataset
from sklearn import preprocessing
import pandas as pd
import numpy as np


class QuantDataset(Dataset):
    def __init__(self, csv_file) -> None:
        self.data_df = pd.read_csv(csv_file).dropna(how='any')
        # 归一化处理(Max-Min): 把数据映射到0～1或-1~1的范围之内处理
        # 把有量纲表达式变成无量纲表达式，便于不同单位或量级的指标能够进行比较和加权。经过归一化后，将有量纲的数据集变成纯量，还可以达到简化计算的作用。
        for i in list(self.data_df):
            if i == 'res' or i == 'secid':
                pass
            else:
                self.data_df[i] = self.data_df[i].astype(float)
                Max = np.max(self.data_df[i])
                Min = np.min(self.data_df[i])
                self.data_df[i] = (self.data_df[i] - Min) / (Max - Min)
        # Z-Score标准化: 原数据转换为符合均值为0，标准差为1的标准正态分布的新数据
        # 提升模型的收敛速度（加快梯度下降的求解速度）
        # 提升模型的精度（消除量级和量纲的影响）
        # zscore = preprocessing.StandardScaler()
        # zscore = zscore.fit_transform(self.data_df)
        # self.data_df = pd.DataFrame(zscore, index=self.data_df.index, columns=self.data_df.columns);

        # 数据的分布本身就服从正态分布，使用Z-Score
        # 有离群值的情况：使用Z-Score

        # Robust标准化：This Scaler removes the median（中位数） and scales the data according to the quantile range(四分位距离，也就是说排除了outliers)
        # robust = preprocessing.RobustScaler()
        pass

    def __len__(self):
        return len(self.data_df)

    def __getitem__(self, index):
        res = int(self.data_df.iloc[index, 1])
        target = torch.zeros((2))
        target[res] = 1.0
        # 需要对数据进行归一化为0～1
        values = torch.FloatTensor(self.data_df.iloc[index, 20:].values)
        return values, target, res


class Net(nn.Module):
    def __init__(self) -> None:
        super(Net, self).__init__()
        self.fc1 = nn.Linear(150, 80)
        self.fc2 = nn.Linear(80, 2)
        self.norm = nn.LayerNorm(80)

    def forward(self, x):
        x = F.relu(x)
        x = self.fc1(x)
        x = F.relu(x)
        # x = self.norm(x)
        x = self.fc2(x)
        return x


def train(args, model, device, train_loader, optimizer, epoch):
    model.train()
    for batch_idx, (data, target, _) in enumerate(train_loader):
        data, target = data.to(device), target.to(device)
        optimizer.zero_grad()
        output = model(data)
        loss = nn.MSELoss()(output, target)
        loss.backward()
        optimizer.step()
        if batch_idx % args.log_interval == 0:
            print('Train Epoch: {} [{}/{} ({:.0f}%)]\tLoss: {:.6f}'.format(
                epoch, batch_idx * len(data), len(train_loader.dataset),
                100. * batch_idx / len(train_loader), loss.item()))
            if args.dry_run:
                break


def test(model, device, test_loader):
    model.eval()
    test_loss = 0
    correct = 0
    with torch.no_grad():
        for data, target, res in test_loader:
            data, target = data.to(device), target.to(device)
            output = model(data)
            # sum up batch loss
            test_loss += nn.MSELoss()(output, target).item()
            # get the index of the max log-probability
            pred = output.argmax(dim=1, keepdim=True)
            if (pred == res):
                correct += 1
                pass

    test_loss /= len(test_loader.dataset)

    print('\nTest set: Average loss: {:.4f}, Accuracy: {}/{} ({:.0f}%)\n'.format(
        test_loss, correct, len(test_loader.dataset),
        100. * correct / len(test_loader.dataset)))


def main():
  # Training settings
    parser = argparse.ArgumentParser(description='PyTorch MNIST Example')
    parser.add_argument('--batch-size', type=int, default=1, metavar='N',
                        help='input batch size for training (default: 1)')
    parser.add_argument('--test-batch-size', type=int, default=1, metavar='N',
                        help='input batch size for testing (default: 1)')
    parser.add_argument('--epochs', type=int, default=3, metavar='N',
                        help='number of epochs to train (default: 3)')
    parser.add_argument('--lr', type=float, default=1.0, metavar='LR',
                        help='learning rate (default: 1.0)')
    parser.add_argument('--gamma', type=float, default=0.7, metavar='M',
                        help='Learning rate step gamma (default: 0.7)')
    parser.add_argument('--no-cuda', action='store_true', default=False,
                        help='disables CUDA training')
    parser.add_argument('--dry-run', action='store_true', default=False,
                        help='quickly check a single pass')
    parser.add_argument('--seed', type=int, default=1, metavar='S',
                        help='random seed (default: 1)')
    parser.add_argument('--log-interval', type=int, default=10, metavar='N',
                        help='how many batches to wait before logging training status')
    parser.add_argument('--save-model', action='store_true', default=False,
                        help='For Saving the current Model')
    args = parser.parse_args()
    use_cuda = not args.no_cuda and torch.cuda.is_available()

    torch.manual_seed(args.seed)
    device = torch.device("cuda" if use_cuda else "cpu")

    # 训练参数
    train_kwargs = {'batch_size': args.batch_size}
    # 测试参数
    test_kwargs = {'batch_size': args.test_batch_size}
    if use_cuda:
        cuda_kwargs = {'num_workers': 1,
                       'pin_memory': True,
                       'shuffle': True}
        train_kwargs.update(cuda_kwargs)
        test_kwargs.update(cuda_kwargs)
    # 读入数据
    dataset1 = QuantDataset(
        '/Users/jimmy/Documents/git/electron-myquantization/src/main/data_2022-05-16.csv')
    dataset2 = QuantDataset(
        '/Users/jimmy/Documents/git/electron-myquantization/src/main/data_2022-05-17.csv')
    dataset3 = QuantDataset(
        '/Users/jimmy/Documents/git/electron-myquantization/src/main/data_2022-05-18.csv')

    dataset4 = QuantDataset(
        '/Users/jimmy/Documents/git/electron-myquantization/src/main/data_2022-05-19.csv')

    # 检查数据是否正确读如
    train_loader1 = torch.utils.data.DataLoader(dataset1, **train_kwargs)
    train_loader2 = torch.utils.data.DataLoader(dataset1, **train_kwargs)
    train_loader3 = torch.utils.data.DataLoader(dataset1, **train_kwargs)
    test_loader = torch.utils.data.DataLoader(dataset2, **test_kwargs)

    # 创建网络
    model = Net().to(device)
    optimizer = optim.Adadelta(model.parameters(), lr=args.lr)

    # 开始训练
    scheduler = StepLR(optimizer, step_size=1, gamma=args.gamma)
    for epoch in range(1, args.epochs + 1):
        train(args, model, device, train_loader1, optimizer, epoch)
        train(args, model, device, train_loader2, optimizer, epoch)
        train(args, model, device, train_loader3, optimizer, epoch)
        test(model, device, test_loader)
        scheduler.step()

    if args.save_model:
        torch.save(model.state_dict(), "mnist_cnn.pt")


if __name__ == '__main__':
    main()

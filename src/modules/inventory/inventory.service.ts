import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { InventoryBatch } from './entities/inventory-batch.entity';
import { InventoryLog, StockMovementType } from './entities/inventory-log.entity';
import { Product } from '../products/entities/product.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { CreateInventoryBatchDto, UpdateInventoryBatchDto, ExportStockDto, TransferStockDto, CreateTransferDto } from './dto/inventory.dto';
import { CreateStocktakeDto, UpdateStocktakeDto } from './dto/stocktake.dto';
import { Stocktake, StocktakeStatus } from './entities/stocktake.entity';
import { StocktakeItem } from './entities/stocktake-item.entity';
import { InventoryTransfer, TransferStatus } from './entities/inventory-transfer.entity';
import { InventoryTransferItem } from './entities/inventory-transfer-item.entity';

export interface InventorySummary {
  product: Product;
  totalImported: number;
  totalStock: number;
  averageCost: number;
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryBatch)
    private inventoryRepository: Repository<InventoryBatch>,
    @InjectRepository(InventoryLog)
    private inventoryLogRepository: Repository<InventoryLog>,
    @InjectRepository(Product)
    private productsRepository: Repository<Product>,
    @InjectRepository(OrderItem)
    private orderItemRepository: Repository<OrderItem>,
    @InjectRepository(Stocktake)
    private stocktakeRepository: Repository<Stocktake>,
    @InjectRepository(StocktakeItem)
    private stocktakeItemRepository: Repository<StocktakeItem>,
    @InjectRepository(InventoryTransfer)
    private transferRepository: Repository<InventoryTransfer>,
    @InjectRepository(InventoryTransferItem)
    private transferItemRepository: Repository<InventoryTransferItem>,
  ) {}

  // ==========================================
  // INVENTORY BATCH & SUMMARY
  // ==========================================
  async findAllBatches(branchId?: string): Promise<InventoryBatch[]> {
    if (branchId === 'undefined' || branchId === 'null' || !branchId) {
      branchId = undefined;
    }
    const whereClause = branchId ? { branchId } : {};
    return this.inventoryRepository.find({
      where: whereClause,
      relations: ['product', 'product.category', 'product.itemGroup', 'distributor'],
      order: { createdAt: 'DESC' }
    });
  }

  async findOneBatch(id: string): Promise<InventoryBatch> {
    const batch = await this.inventoryRepository.findOne({ 
      where: { id }, 
      relations: ['product', 'product.category', 'product.itemGroup', 'distributor'] 
    });
    if (!batch) {
      throw new NotFoundException(`Batch with ID ${id} not found`);
    }
    return batch;
  }

  async getInventorySummary(branchId?: string): Promise<InventorySummary[]> {
    // Sanitize branchId - sometimes frontend sends "undefined" as a string
    if (branchId === 'undefined' || branchId === 'null' || !branchId) {
      branchId = undefined;
    }

    // Get all products
    const products = await this.productsRepository.find({ 
      order: { name: 'ASC' },
      relations: ['category', 'itemGroup', 'unit']
    });
    
    // Get batches, optionally filtered by branch
    const whereClause = branchId ? { branchId } : {};
    const batches = await this.inventoryRepository.find({
      where: whereClause
    });

    // Group batches by productId and calculate totals
    const summary: InventorySummary[] = products.map(product => {
      const productBatches = batches.filter(b => b.productId === product.id);
      
      let totalImported = 0;
      let totalStock = 0;
      let totalValue = 0;

      productBatches.forEach(batch => {
        totalImported += batch.importedQuantity;
        totalStock += batch.currentQuantity;
        totalValue += (batch.currentQuantity * Number(batch.costPrice)); // costPrice might be a string from numeric column
      });

      const averageCost = totalStock > 0 ? totalValue / totalStock : 0;

      return {
        product,
        totalImported,
        totalStock,
        averageCost
      };
    });

    return summary;
  }

  async createBatch(createDto: CreateInventoryBatchDto): Promise<InventoryBatch> {
    const batch = this.inventoryRepository.create({
      ...createDto,
      currentQuantity: createDto.currentQuantity ?? createDto.importedQuantity,
    });
    return this.inventoryRepository.save(batch);
  }

  async bulkCreateBatches(createDtos: CreateInventoryBatchDto[]): Promise<InventoryBatch[]> {
    const batches = createDtos.map(dto => this.inventoryRepository.create({
      ...dto,
      currentQuantity: dto.currentQuantity ?? dto.importedQuantity,
    }));
    return this.inventoryRepository.save(batches);
  }

  async updateBatch(id: string, updateDto: UpdateInventoryBatchDto): Promise<InventoryBatch> {
    const batch = await this.inventoryRepository.findOne({ where: { id } });
    if (!batch) {
      throw new NotFoundException(`Batch with ID ${id} not found`);
    }

    // Sanitize null values for NOT NULL numeric columns
    const numericFields: (keyof UpdateInventoryBatchDto)[] = [
      'taxAmount',
      'discountAmount',
      'shippingFee',
      'costPrice',
      'importedQuantity',
      'currentQuantity',
    ];
    numericFields.forEach((field) => {
      if (updateDto[field] === null) {
        (updateDto as any)[field] = 0;
      }
    });

    if (updateDto.importedQuantity !== undefined && updateDto.currentQuantity === undefined) {
      const quantityDiff = updateDto.importedQuantity - batch.importedQuantity;
      updateDto.currentQuantity = Math.max(0, batch.currentQuantity + quantityDiff);
    }

    await this.inventoryRepository.update(id, updateDto);
    return this.inventoryRepository.findOne({ where: { id }, relations: ['product', 'distributor'] }) as Promise<InventoryBatch>;
  }

  async deleteBatch(id: string): Promise<void> {
    const batch = await this.inventoryRepository.findOne({ where: { id } });
    if (!batch) {
      throw new NotFoundException(`Batch with ID ${id} not found`);
    }
    await this.inventoryRepository.remove(batch);
  }

  async deductStock(
    productId: string,
    branchId: string,
    quantity: number,
    referenceCode: string,
    userId: string,
  ): Promise<void> {
    if (quantity <= 0) return;

    const batches = await this.inventoryRepository.find({
      where: {
        productId,
        branchId,
        currentQuantity: MoreThan(0),
      },
      order: {
        expiryDate: 'ASC',
        createdAt: 'ASC',
      },
    });

    let remainingToDeduct = quantity;

    for (const batch of batches) {
      if (remainingToDeduct <= 0) break;

      const deductAmount = Math.min(batch.currentQuantity, remainingToDeduct);
      batch.currentQuantity -= deductAmount;
      remainingToDeduct -= deductAmount;

      await this.inventoryRepository.save(batch);

      const log = this.inventoryLogRepository.create({
        productId,
        branchId,
        type: StockMovementType.SALE,
        quantity: -deductAmount,
        batchId: batch.id,
        referenceCode,
        note: `Bán ${deductAmount} sản phẩm qua đơn hàng ${referenceCode}`,
        createdById: userId,
      });
      await this.inventoryLogRepository.save(log);
    }

    if (remainingToDeduct > 0) {
      const log = this.inventoryLogRepository.create({
        productId,
        branchId,
        type: StockMovementType.SALE,
        quantity: -remainingToDeduct,
        referenceCode,
        note: `Bán vượt kho ${remainingToDeduct} sản phẩm qua đơn hàng ${referenceCode}`,
        createdById: userId,
      });
      await this.inventoryLogRepository.save(log);
    }
  }

  async getStockHistory(branchId?: string, page = 1, limit = 10): Promise<{ data: any[]; total: number }> {
    if (branchId === 'undefined' || branchId === 'null' || !branchId) {
      branchId = undefined;
    }
    const whereClause = branchId ? { branchId } : {};
    const [data, total] = await this.inventoryLogRepository.findAndCount({
      where: whereClause,
      relations: ['product', 'createdBy'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total };
  }

  // Returns a map of productId -> totalQuantitySold (from COMPLETED orders only)
  async getProductSalesRank(branchId?: string): Promise<Record<string, number>> {
    const qb = this.orderItemRepository.createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .select('oi.productId', 'productId')
      .addSelect('SUM(oi.quantity)', 'totalSold')
      .where('o.status = :status', { status: 'COMPLETED' })
      .groupBy('oi.productId')
      .orderBy('"totalSold"', 'DESC');

    if (branchId && branchId !== 'undefined' && branchId !== 'null') {
      qb.andWhere('o.branchId = :branchId', { branchId });
    }

    const rows = await qb.getRawMany();
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.productId] = Number(row.totalSold) || 0;
    }
    return result;
  }

  // ==========================================
  // STOCKTAKES (KIỂM KHO)
  // ==========================================

  async findAllStocktakes(branchId?: string): Promise<Stocktake[]> {
    if (branchId === 'undefined' || branchId === 'null' || !branchId) {
      branchId = undefined;
    }
    const whereClause = branchId ? { branchId } : {};
    return this.stocktakeRepository.find({
      where: whereClause,
      relations: ['createdBy', 'approvedBy', 'items', 'items.product'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOneStocktake(id: string): Promise<Stocktake> {
    const stocktake = await this.stocktakeRepository.findOne({
      where: { id },
      relations: ['createdBy', 'approvedBy', 'items', 'items.product', 'items.product.unit'],
    });
    if (!stocktake) {
      throw new NotFoundException(`Stocktake ${id} not found`);
    }
    return stocktake;
  }

  async createStocktake(createDto: CreateStocktakeDto, userId: string): Promise<Stocktake> {
    // Generate a unique code
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.stocktakeRepository.count();
    const code = `STK-${dateStr}-${(count + 1).toString().padStart(4, '0')}`;

    const stocktake = this.stocktakeRepository.create({
      code,
      branchId: createDto.branchId,
      note: createDto.note,
      createdById: userId,
      status: StocktakeStatus.PENDING,
      items: createDto.items.map(item => this.stocktakeItemRepository.create({
        productId: item.productId,
        systemQuantity: item.systemQuantity,
        actualQuantity: item.actualQuantity,
        difference: item.difference,
        reason: item.reason,
      })),
    });

    return this.stocktakeRepository.save(stocktake);
  }

  async updateStocktake(id: string, updateDto: UpdateStocktakeDto): Promise<Stocktake> {
    const stocktake = await this.findOneStocktake(id);
    if (stocktake.status !== StocktakeStatus.PENDING) {
      throw new Error('Only PENDING stocktakes can be updated');
    }

    if (updateDto.note !== undefined) stocktake.note = updateDto.note;
    
    if (updateDto.items) {
      // Remove old items
      await this.stocktakeItemRepository.delete({ stocktakeId: id });
      
      // Add new items
      stocktake.items = updateDto.items.map(item => this.stocktakeItemRepository.create({
        productId: item.productId,
        systemQuantity: item.systemQuantity,
        actualQuantity: item.actualQuantity,
        difference: item.difference,
        reason: item.reason,
      }));
    }

    return this.stocktakeRepository.save(stocktake);
  }

  async approveStocktake(id: string, userId: string, action: 'COMPLETED' | 'CANCELLED'): Promise<Stocktake> {
    const stocktake = await this.findOneStocktake(id);
    
    if (stocktake.status !== StocktakeStatus.PENDING) {
      throw new Error(`Cannot change status. Current status is ${stocktake.status}`);
    }

    stocktake.status = action === 'COMPLETED' ? StocktakeStatus.COMPLETED : StocktakeStatus.CANCELLED;
    stocktake.approvedById = userId;

    await this.stocktakeRepository.save(stocktake);

    if (stocktake.status === StocktakeStatus.COMPLETED) {
      // Adjust inventory based on items difference
      for (const item of stocktake.items) {
        if (item.difference === 0) continue;

        if (item.difference < 0) {
          // Actual < System => We lost some items. Need to deduct.
          await this.deductStock(
            item.productId,
            stocktake.branchId,
            Math.abs(item.difference),
            stocktake.code,
            userId,
          );
        } else if (item.difference > 0) {
          // Actual > System => We have more items. Create an adjustment batch.
          const batch = this.inventoryRepository.create({
            productId: item.productId,
            branchId: stocktake.branchId,
            importedQuantity: item.difference,
            currentQuantity: item.difference,
            costPrice: 0, // Or avg cost if possible, but 0 is safe for adjustments
            personnelName: 'Hệ thống (Kiểm kho)',
            importDate: new Date(),
          });
          const savedBatch = await this.inventoryRepository.save(batch);

          // Log the adjustment
          const log = this.inventoryLogRepository.create({
            productId: item.productId,
            branchId: stocktake.branchId,
            type: StockMovementType.ADJUST,
            quantity: item.difference,
            batchId: savedBatch.id,
            referenceCode: stocktake.code,
            note: `Điều chỉnh tăng dư kho ${item.difference} sản phẩm`,
            createdById: userId,
          });
          await this.inventoryLogRepository.save(log);
        }
      }
    }

    return stocktake;
  }

  async exportStock(dto: ExportStockDto, userId: string): Promise<void> {
    const { branchId, productId, quantity, note } = dto;
    
    if (quantity <= 0) {
      throw new Error('Số lượng xuất kho phải lớn hơn 0');
    }

    const batches = await this.inventoryRepository.find({
      where: {
        productId,
        branchId,
        currentQuantity: MoreThan(0),
      },
      order: {
        expiryDate: 'ASC',
        createdAt: 'ASC',
      },
    });

    const totalAvailable = batches.reduce((sum, b) => sum + b.currentQuantity, 0);
    if (totalAvailable < quantity) {
      throw new Error(`Số lượng tồn kho không đủ để xuất (Tồn kho hiện tại: ${totalAvailable})`);
    }

    let remainingToDeduct = quantity;
    const refCode = 'EXP-' + new Date().getTime();

    for (const batch of batches) {
      if (remainingToDeduct <= 0) break;

      const deductAmount = Math.min(batch.currentQuantity, remainingToDeduct);
      batch.currentQuantity -= deductAmount;
      remainingToDeduct -= deductAmount;

      await this.inventoryRepository.save(batch);

      const log = this.inventoryLogRepository.create({
        productId,
        branchId,
        type: StockMovementType.EXPORT,
        quantity: -deductAmount,
        batchId: batch.id,
        referenceCode: refCode,
        note: note || `Xuất kho ${deductAmount} sản phẩm`,
        createdById: userId,
      });
      await this.inventoryLogRepository.save(log);
    }
  }

  async transferStock(dto: CreateTransferDto, userId: string): Promise<InventoryTransfer> {
    const { fromBranchId, toBranchId, items, note } = dto;

    if (fromBranchId === toBranchId) {
      throw new Error('Chi nhánh nguồn và chi nhánh đích không thể trùng nhau');
    }

    if (!items || items.length === 0) {
      throw new Error('Danh sách sản phẩm chuyển kho không được để trống');
    }

    // Generate a unique code
    const code = 'TRSF-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(1000 + Math.random() * 9000);

    const transfer = this.transferRepository.create({
      code,
      fromBranchId,
      toBranchId,
      note,
      createdById: userId,
      status: TransferStatus.PENDING,
      items: [],
    });

    const savedTransfer = await this.transferRepository.save(transfer);
    const transferItems: InventoryTransferItem[] = [];

    for (const item of items) {
      const { productId, quantity } = item;
      if (quantity <= 0) {
        throw new Error('Số lượng chuyển kho phải lớn hơn 0');
      }

      // Get batches at source branch ordered by expiry date and creation date
      const batches = await this.inventoryRepository.find({
        where: {
          productId,
          branchId: fromBranchId,
          currentQuantity: MoreThan(0),
        },
        order: {
          expiryDate: 'ASC',
          createdAt: 'ASC',
        },
      });

      const totalAvailable = batches.reduce((sum, b) => sum + b.currentQuantity, 0);
      if (totalAvailable < quantity) {
        throw new Error(`Số lượng sản phẩm trong kho nguồn không đủ để thực hiện chuyển kho`);
      }

      let remainingToDeduct = quantity;
      for (const batch of batches) {
        if (remainingToDeduct <= 0) break;

        const deductAmount = Math.min(batch.currentQuantity, remainingToDeduct);
        const originalCostPrice = batch.costPrice;

        // Deduct from source batch
        batch.currentQuantity -= deductAmount;
        remainingToDeduct -= deductAmount;
        await this.inventoryRepository.save(batch);

        // Log EXPORT at source branch
        const exportLog = this.inventoryLogRepository.create({
          productId,
          branchId: fromBranchId,
          type: StockMovementType.EXPORT,
          quantity: -deductAmount,
          batchId: batch.id,
          referenceCode: code,
          note: note || `Chuyển kho ${deductAmount} sản phẩm sang chi nhánh khác`,
          createdById: userId,
        });
        await this.inventoryLogRepository.save(exportLog);

        // Save transfer item detail
        const transferItem = this.transferItemRepository.create({
          transferId: savedTransfer.id,
          productId,
          quantity: deductAmount,
          costPrice: originalCostPrice,
          expiryDate: batch.expiryDate,
          invoiceName: batch.invoiceName,
        });
        transferItems.push(await this.transferItemRepository.save(transferItem));
      }
    }

    savedTransfer.items = transferItems;
    return savedTransfer;
  }

  async confirmTransfer(id: string, userId: string): Promise<InventoryTransfer> {
    const transfer = await this.transferRepository.findOne({
      where: { id },
      relations: ['items', 'items.product'],
    });

    if (!transfer) {
      throw new NotFoundException(`Không tìm thấy phiếu chuyển kho với ID ${id}`);
    }

    if (transfer.status !== TransferStatus.PENDING) {
      throw new Error('Phiếu chuyển kho này không ở trạng thái chờ nhận');
    }

    transfer.status = TransferStatus.COMPLETED;
    transfer.confirmedById = userId;
    const updatedTransfer = await this.transferRepository.save(transfer);

    // Create batches and log imports at receiving branch
    for (const item of transfer.items) {
      const newBatch = this.inventoryRepository.create({
        productId: item.productId,
        branchId: transfer.toBranchId,
        importedQuantity: item.quantity,
        currentQuantity: item.quantity,
        costPrice: item.costPrice,
        personnelName: 'Hệ thống (Nhận chuyển kho)',
        importDate: new Date(),
        expiryDate: item.expiryDate,
        invoiceName: item.invoiceName,
      });
      const savedBatch = await this.inventoryRepository.save(newBatch);

      // Log IMPORT at receiving branch
      const importLog = this.inventoryLogRepository.create({
        productId: item.productId,
        branchId: transfer.toBranchId,
        type: StockMovementType.IMPORT,
        quantity: item.quantity,
        batchId: savedBatch.id,
        referenceCode: transfer.code,
        note: transfer.note || `Nhận chuyển kho ${item.quantity} sản phẩm`,
        createdById: userId,
      });
      await this.inventoryLogRepository.save(importLog);
    }

    return updatedTransfer;
  }

  async cancelTransfer(id: string, userId: string): Promise<InventoryTransfer> {
    const transfer = await this.transferRepository.findOne({
      where: { id },
      relations: ['items'],
    });

    if (!transfer) {
      throw new NotFoundException(`Không tìm thấy phiếu chuyển kho với ID ${id}`);
    }

    if (transfer.status !== TransferStatus.PENDING) {
      throw new Error('Phiếu chuyển kho này không ở trạng thái chờ nhận');
    }

    transfer.status = TransferStatus.CANCELLED;
    transfer.confirmedById = userId;
    const updatedTransfer = await this.transferRepository.save(transfer);

    // Restore stock back to source branch
    for (const item of transfer.items) {
      const newBatch = this.inventoryRepository.create({
        productId: item.productId,
        branchId: transfer.fromBranchId,
        importedQuantity: item.quantity,
        currentQuantity: item.quantity,
        costPrice: item.costPrice,
        personnelName: 'Hệ thống (Hoàn trả chuyển kho)',
        importDate: new Date(),
        expiryDate: item.expiryDate,
        invoiceName: item.invoiceName,
      });
      const savedBatch = await this.inventoryRepository.save(newBatch);

      // Log IMPORT at source branch (returning stock)
      const importLog = this.inventoryLogRepository.create({
        productId: item.productId,
        branchId: transfer.fromBranchId,
        type: StockMovementType.IMPORT,
        quantity: item.quantity,
        batchId: savedBatch.id,
        referenceCode: transfer.code,
        note: `Hủy nhận hàng - Hoàn trả ${item.quantity} sản phẩm`,
        createdById: userId,
      });
      await this.inventoryLogRepository.save(importLog);
    }

    return updatedTransfer;
  }

  async findAllTransfers(branchId?: string, status?: TransferStatus): Promise<InventoryTransfer[]> {
    const query = this.transferRepository.createQueryBuilder('transfer')
      .leftJoinAndSelect('transfer.fromBranch', 'fromBranch')
      .leftJoinAndSelect('transfer.toBranch', 'toBranch')
      .leftJoinAndSelect('transfer.createdBy', 'createdBy')
      .leftJoinAndSelect('transfer.confirmedBy', 'confirmedBy')
      .leftJoinAndSelect('transfer.items', 'items')
      .leftJoinAndSelect('items.product', 'product')
      .leftJoinAndSelect('product.unit', 'unit')
      .orderBy('transfer.createdAt', 'DESC');

    if (branchId && branchId !== 'undefined' && branchId !== 'null') {
      query.andWhere('(transfer.fromBranchId = :branchId OR transfer.toBranchId = :branchId)', { branchId });
    }

    if (status) {
      query.andWhere('transfer.status = :status', { status });
    }

    return query.getMany();
  }

  async findOneTransfer(id: string): Promise<InventoryTransfer> {
    const transfer = await this.transferRepository.findOne({
      where: { id },
      relations: ['fromBranch', 'toBranch', 'createdBy', 'confirmedBy', 'items', 'items.product', 'items.product.unit'],
    });
    if (!transfer) {
      throw new NotFoundException(`Không tìm thấy phiếu chuyển kho với ID ${id}`);
    }
    return transfer;
  }
}

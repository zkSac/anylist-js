const FormData = require('form-data');
const uuid = require('./uuid');

// Fields we don't edit directly but must round-trip through full-item
// `update-list-item` operations so they aren't wiped.
const PASSTHROUGH_FIELDS = [
	'recipeId', 'rawIngredient', 'priceMatchupTag', 'priceId', 'photoIds', 'eventId',
	'prices', 'priceQuantityPb', 'priceQuantityShouldOverrideItemQuantity',
	'packageSizePb', 'pricePackageSizePb', 'pricePackageSizeShouldOverrideItemPackageSize',
	'ingredients', 'itemQuantityShouldOverrideIngredientQuantity',
	'itemPackageSizeShouldOverrideIngredientPackageSize', 'productUpc',
];

const OP_MAPPING = {
	name: 'set-list-item-name',
	quantity: 'set-list-item-quantity',
	details: 'set-list-item-details',
	checked: 'set-list-item-checked',
	categoryMatchId: 'set-list-item-category-match-id',
	manualSortIndex: 'set-list-item-sort-order',
};

/**
 * Item class.
 * @class
 *
 * @param {object} item item
 * @param {object} context context
 *
 * @property {string} listId
 * @property {string} identifier
 * @property {string} name
 * @property {string} details
 * @property {string} quantity
 * @property {string} checked
 * @property {string} manualSortIndex
 * @property {string} userId
 * @property {string} categoryMatchId
 */
class Item {
	/**
   * @hideconstructor
   */
	constructor(i, {client, protobuf, uid}) {
		this._listId = i.listId;
		this._identifier = i.identifier || uuid();
		this._name = i.name;
		this._details = i.details;
		// Read the quantity as the AnyList apps display it: rawQuantity is the full
		// text the user typed ("500 g"); fall back to joining the split amount/unit,
		// then to the legacy fields.
		this._quantity = i.quantityPb?.rawQuantity
			|| [i.quantityPb?.amount, i.quantityPb?.unit].filter(Boolean).join(' ')
			|| i.deprecatedQuantity
			|| i.quantity;
		this._checked = i.checked;
		this._manualSortIndex = i.manualSortIndex;
		this._userId = i.userId;
		this._categoryMatchId = i.categoryMatchId || 'other';
		this._category = i.category;
		this._categoryAssignments = (i.categoryAssignments || []).map(a => ({
			identifier: a.identifier,
			categoryGroupId: a.categoryGroupId,
			categoryId: a.categoryId,
		}));
		this._storeIds = i.storeIds || [];
		this._passthrough = {};
		for (const f of PASSTHROUGH_FIELDS) {
			if (i[f] !== undefined && i[f] !== null && !(Array.isArray(i[f]) && i[f].length === 0)) {
				this._passthrough[f] = i[f];
			}
		}

		this._client = client;
		this._protobuf = protobuf;
		this._uid = uid;

		this._fieldsToUpdate = [];
	}

	get categoryAssignments() {
		return this._categoryAssignments;
	}

	toJSON() {
		return {
			listId: this._listId,
			identifier: this._identifier,
			name: this._name,
			details: this._details,
			quantity: this._quantity,
			checked: this._checked,
			manualSortIndex: this._manualSortIndex,
			userId: this._userId,
			categoryMatchId: this._categoryMatchId,
			storeIds: this._storeIds,
			prices: (this._passthrough.prices || []).map(p => ({
				amount: p.amount,
				details: p.details,
				storeId: p.storeId,
				date: p.date,
			})),
			packageSize: this._passthrough.packageSizePb?.rawPackageSize
				|| [this._passthrough.packageSizePb?.size, this._passthrough.packageSizePb?.unit].filter(Boolean).join(' ')
				|| undefined,
			upc: this._passthrough.productUpc,
			photoIds: this._passthrough.photoIds || [],
		};
	}

	_encode() {
		const item = {
			identifier: this._identifier,
			listId: this._listId,
			name: this._name,
			details: this._details,
			checked: this._checked,
			category: this._category,
			userId: this._userId,
			categoryMatchId: this._categoryMatchId,
			categoryAssignments: this._categoryAssignments,
			manualSortIndex: this._manualSortIndex,
			storeIds: this._storeIds,
			...this._passthrough,
		};

		// Encode quantity as a PBItemQuantity. The apps render `rawQuantity`, so it
		// must be set; `amount`/`unit` are the parsed split (all strings).
		const rawQuantity = this._quantity == null ? '' : String(this._quantity).trim();
		if (rawQuantity !== '') {
			const parts = rawQuantity.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
			item.quantityPb = {rawQuantity};
			if (parts) {
				item.quantityPb.amount = parts[1];
				if (parts[2]) {
					item.quantityPb.unit = parts[2];
				}
			}
		}

		return new this._protobuf.ListItem(item);

	}

	get identifier() {
		return this._identifier;
	}

	set identifier(_) {
		throw new Error('You cannot update an item ID.');
	}

	get listId() {
		return this._listId;
	}

	set listId(l) {
		if (this._listId === undefined) {
			this._listId = l;
			this._fieldsToUpdate.push('listId');
		} else {
			throw new Error('You cannot move items between lists.');
		}
	}

	get name() {
		return this._name;
	}

	set name(n) {
		this._name = n;
		this._fieldsToUpdate.push('name');
	}

	get quantity() {
		return this._quantity;
	}

	set quantity(q) {
		if (typeof q === 'number') {
			q = q.toString();
		}

		this._quantity = q;
		this._fieldsToUpdate.push('quantity');
	}

	get details() {
		return this._details;
	}

	set details(d) {
		this._details = d;
		this._fieldsToUpdate.push('details');
	}

	get checked() {
		return this._checked;
	}

	set checked(c) {
		if (typeof c !== 'boolean') {
			throw new TypeError('Checked must be a boolean.');
		}

		this._checked = c;
		this._fieldsToUpdate.push('checked');
	}

	get userId() {
		return this._userId;
	}

	set userId(_) {
		throw new Error('Cannot set user ID of an item after creation.');
	}

	get categoryMatchId() {
		return this._categoryMatchId;
	}

	set categoryMatchId(i) {
		this._categoryMatchId = i;
		this._fieldsToUpdate.push('categoryMatchId');
	}

	get storeIds() {
		return this._storeIds;
	}

	get manualSortIndex() {
		return this._manualSortIndex;
	}

	set manualSortIndex(i) {
		if (typeof i !== 'number') {
			throw new TypeError('Sort index must be a number.');
		}

		this._manualSortIndex = i;
		this._fieldsToUpdate.push('manualSortIndex');
	}

	_newOp(handlerId) {
		const op = new this._protobuf.PBListOperation();
		op.setMetadata({
			operationId: uuid(),
			handlerId,
			userId: this._uid,
		});
		op.setListId(this._listId);
		op.setListItemId(this._identifier);
		return op;
	}

	async _postOps(ops) {
		const opList = new this._protobuf.PBListOperationList();
		opList.setOperations(ops);
		const form = new FormData();
		form.append('operations', opList.toBuffer());
		await this._client.post('data/shopping-lists/update', {body: form});
	}

	/**
   * Set price, package size and/or UPC on this item, using the same dedicated
   * operations the AnyList web app sends (`save-item-price`,
   * `set-list-item-package-size`, `set-list-item-product-upc`).
   *
   * @param {object} options
   * @param {number|null} [options.price] unit price; null removes the price for that store
   * @param {string} [options.storeId] store the price applies to ('' = no store)
   * @param {string} [options.priceDetails] free text, e.g. "per lb"
   * @param {string|null} [options.packageSize] e.g. "500 g"; null clears
   * @param {string|null} [options.upc] product barcode; null clears
   * @return {Promise}
   */
	async setPricing({price, storeId, priceDetails, packageSize, upc} = {}) {
		const ops = [];
		const prices = this._passthrough.prices || [];

		if (price !== undefined) {
			if (price !== null && (typeof price !== 'number' || !Number.isFinite(price))) {
				throw new TypeError('Price must be a finite number or null.');
			}

			const op = this._newOp('save-item-price');
			const itemPrice = {};
			if (storeId) {
				itemPrice.storeId = storeId;
			}

			const others = prices.filter(p => (p.storeId || '') !== (storeId || ''));
			if (price === null) {
				this._passthrough.prices = others;
			} else {
				itemPrice.amount = price;
				if (priceDetails) {
					itemPrice.details = priceDetails;
				}

				this._passthrough.prices = [...others, itemPrice];
			}

			op.setItemPrice(new this._protobuf.PBItemPrice(itemPrice));
			ops.push(op);
		}

		if (packageSize !== undefined) {
			let pkg = null;
			if (packageSize !== null && String(packageSize).trim() !== '') {
				const raw = String(packageSize).trim();
				const m = raw.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
				pkg = {rawPackageSize: raw};
				if (m) {
					pkg.size = m[1];
					if (m[2]) {
						pkg.unit = m[2];
					}
				}
			}

			const op = this._newOp('set-list-item-package-size');
			const li = {identifier: this._identifier, listId: this._listId};
			if (pkg) {
				li.packageSizePb = pkg;
			}

			op.setListItem(new this._protobuf.ListItem(li));
			ops.push(op);
			if (pkg) {
				this._passthrough.packageSizePb = pkg;
			} else {
				delete this._passthrough.packageSizePb;
			}
		}

		if (upc !== undefined) {
			const value = upc === null ? '' : String(upc);
			const op = this._newOp('set-list-item-product-upc');
			op.setUpdatedValue(value);
			op.setOriginalValue(this._passthrough.productUpc || '');
			ops.push(op);
			if (value) {
				this._passthrough.productUpc = value;
			} else {
				delete this._passthrough.productUpc;
			}
		}

		if (ops.length > 0) {
			await this._postOps(ops);
		}
	}

	/**
   * Attach a photo to this item. AnyList's server downloads the image from
   * `photoUrl` (`data/photos/upload-url`), then the item is pointed at the
   * new photo id via `set-list-item-photo-id`. Pass null to remove the photo.
   *
   * @param {string|Buffer|null} photo public URL of an image, or a Buffer with the
   *   image bytes (multipart upload to `data/photos/upload`)
   * @return {Promise<string|null>} the photo id
   */
	async setPhoto(photo) {
		let photoId = '';
		if (Buffer.isBuffer(photo)) {
			photoId = uuid();
			const form = new FormData();
			form.append('filename', photoId + '.jpg');
			form.append('photo', photo, {filename: photoId + '.jpg'});
			await this._client.post('data/photos/upload', {body: form});
		} else if (photo) {
			photoId = uuid();
			const form = new FormData();
			form.append('photo_url', photo);
			form.append('photo_id', photoId);
			await this._client.post('data/photos/upload-url', {body: form});
		}

		const op = this._newOp('set-list-item-photo-id');
		op.setUpdatedValue(photoId);
		op.setOriginalValue('');
		await this._postOps([op]);
		this._passthrough.photoIds = photoId ? [photoId] : [];
		return photoId || null;
	}

   /**
   * Assign this item to a custom (per-list) category.
   *
   * Sends an `update-list-item` operation containing the full PBListItem with
   * both `categoryAssignments` and `categoryMatchId` populated. Setting only
   * `categoryMatchId` (the per-field handler) creates a "shadow" entry that
   * isn't recognized as a real category-group membership.
   *
   * @param {object} options
   * @param {string} options.categoryGroupId
   * @param {string} options.categoryId
   * @param {string} options.matchId  The slug AnyList uses for grouping/display.
   *                                   Caller should pass the systemCategory of
   *                                   the target if non-null, or copy from a
   *                                   sibling item, or fall back to a slug of
   *                                   the category name.
   * @return {Promise}
   */
	async assignToCustomCategory({categoryGroupId, categoryId, matchId}) {
		this._categoryMatchId = matchId;
		this._categoryAssignments = [{
			identifier: uuid(),
			categoryGroupId,
			categoryId,
		}];

		const op = new this._protobuf.PBListOperation();
		op.setMetadata({
			operationId: uuid(),
			handlerId: 'update-list-item',
			userId: this._uid,
		});
		op.setListId(this._listId);
		op.setListItemId(this._identifier);
		op.setListItem(this._encode());

		const opList = new this._protobuf.PBListOperationList();
		opList.setOperations([op]);

		const form = new FormData();
		form.append('operations', opList.toBuffer());

		await this._client.post('data/shopping-lists/update', {body: form});

		// Drop any pending field-level updates for category fields so a later
		// .save() doesn't replay a stale single-field op over our full update.
		this._fieldsToUpdate = this._fieldsToUpdate.filter(f => f !== 'categoryMatchId');
   
	}
	/**
   * Assign this item to the given stores (by store ID),
   * or pass an empty array to clear its store assignment.
   * AnyList tracks store assignment per store ID, so this
   * reconciles the current set against the desired set,
   * adding/removing individual store IDs as needed, and
   * sends the change to AnyList's API immediately.
   * Must set `isFavorite=true` if editing "favorites" list
   * @param {string[]} [storeIds=[]]
   * @param {boolean} [isFavorite=false]
   * @return {Promise}
   */
	async setStores(storeIds = [], isFavorite = false) {
		const current = this._storeIds || [];
		const toAdd = storeIds.filter(id => !current.includes(id));
		const toRemove = current.filter(id => !storeIds.includes(id));

		const ops = [];

		for (const [handlerId, ids] of [['add-list-item-store-id', toAdd], ['remove-list-item-store-id', toRemove]]) {
			for (const storeId of ids) {
				const op = new this._protobuf.PBListOperation();

				op.setMetadata({
					operationId: uuid(),
					handlerId,
					userId: this._uid,
				});

				op.setListId(this._listId);
				op.setListItemId(this._identifier);
				op.setUpdatedValue(storeId);

				ops.push(op);
			}
		}

		this._storeIds = storeIds;

		if (ops.length === 0) {
			return;
		}

		const opList = new this._protobuf.PBListOperationList();

		opList.setOperations(ops);

		const form = new FormData();

		form.append('operations', opList.toBuffer());

		await this._client.post(isFavorite ? 'data/starter-lists/update' : 'data/shopping-lists/update', {
			body: form,
		});
	}

	/**
   * Assign this item to a custom (per-list) category.
   *
   * Sends an `update-list-item` operation containing the full PBListItem with
   * both `categoryAssignments` and `categoryMatchId` populated. Setting only
   * `categoryMatchId` (the per-field handler) creates a "shadow" entry that
   * isn't recognized as a real category-group membership.
   *
   * @param {object} options
   * @param {string} options.categoryGroupId
   * @param {string} options.categoryId
   * @param {string} options.matchId  The slug AnyList uses for grouping/display.
   *                                   Caller should pass the systemCategory of
   *                                   the target if non-null, or copy from a
   *                                   sibling item, or fall back to a slug of
   *                                   the category name.
   * @return {Promise}
   */
	async assignToCustomCategory({categoryGroupId, categoryId, matchId}) {
		this._categoryMatchId = matchId;
		this._categoryAssignments = [{
			identifier: uuid(),
			categoryGroupId,
			categoryId,
		}];

		const op = new this._protobuf.PBListOperation();
		op.setMetadata({
			operationId: uuid(),
			handlerId: 'update-list-item',
			userId: this._uid,
		});
		op.setListId(this._listId);
		op.setListItemId(this._identifier);
		op.setListItem(this._encode());

		const opList = new this._protobuf.PBListOperationList();
		opList.setOperations([op]);

		const form = new FormData();
		form.append('operations', opList.toBuffer());

		await this._client.post('data/shopping-lists/update', {body: form});

		// Drop any pending field-level updates for category fields so a later
		// .save() doesn't replay a stale single-field op over our full update.
		this._fieldsToUpdate = this._fieldsToUpdate.filter(f => f !== 'categoryMatchId');
	}
	/**
   * Assign this item to the given stores (by store ID),
   * or pass an empty array to clear its store assignment.
   * AnyList tracks store assignment per store ID, so this
   * reconciles the current set against the desired set,
   * adding/removing individual store IDs as needed, and
   * sends the change to AnyList's API immediately.
   * Must set `isFavorite=true` if editing "favorites" list
   * @param {string[]} [storeIds=[]]
   * @param {boolean} [isFavorite=false]
   * @return {Promise}
   */
	async setStores(storeIds = [], isFavorite = false) {
		const current = this._storeIds || [];
		const toAdd = storeIds.filter(id => !current.includes(id));
		const toRemove = current.filter(id => !storeIds.includes(id));

		const ops = [];

		for (const [handlerId, ids] of [['add-list-item-store-id', toAdd], ['remove-list-item-store-id', toRemove]]) {
			for (const storeId of ids) {
				const op = new this._protobuf.PBListOperation();

				op.setMetadata({
					operationId: uuid(),
					handlerId,
					userId: this._uid,
				});

				op.setListId(this._listId);
				op.setListItemId(this._identifier);
				op.setUpdatedValue(storeId);

				ops.push(op);
			}
		}

		this._storeIds = storeIds;

		if (ops.length === 0) {
			return;
		}

		const opList = new this._protobuf.PBListOperationList();

		opList.setOperations(ops);

		const form = new FormData();

		form.append('operations', opList.toBuffer());

		await this._client.post(isFavorite ? 'data/starter-lists/update' : 'data/shopping-lists/update', {
			body: form,
		});
	}

	/**
   * Save local changes to item to
   * AnyList's API.
   * Must set `isFavorite=true` if editing "favorites" list
   * @param {boolean} [isFavorite=false]
   * @return {Promise}
   */
	async save(isFavorite = false) {
		const ops = this._fieldsToUpdate.map(field => {
			const value = this[field];
			const opName = OP_MAPPING[field];

			const op = new this._protobuf.PBListOperation();

			op.setMetadata({
				operationId: uuid(),
				handlerId: opName,
				userId: this._uid,
			});

			op.setListId(this._listId);
			op.setListItemId(this._identifier);

			if (typeof value === 'boolean') {
				op.setUpdatedValue(value === true ? 'y' : 'n');
			} else {
				op.setUpdatedValue(value.toString());
			}

			return op;
		});

		const opList = new this._protobuf.PBListOperationList();

		opList.setOperations(ops);

		const form = new FormData();

		form.append('operations', opList.toBuffer());

		await this._client.post(isFavorite ? 'data/starter-lists/update' : 'data/shopping-lists/update', {
			body: form,
		});
	}
}

module.exports = Item;

//! Worldo's shared three-city ledger. Gameplay effects come from a trusted
//! server oracle, but coins cannot be minted after initialization. Harvest is
//! minted only into the buying city during a signed, account-bound sale.
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PublicKey};
use std::collections::BTreeMap;

const MAX_EFFECTS: usize = 128;
const MAX_AMOUNT: u64 = 1_000_000;
const RECEIPT_HISTORY: u64 = 512;
const BATCH_HISTORY: u64 = 128;

#[near(serializers=[borsh,json])]
#[derive(Clone, Default)]
pub struct Holding {
    pub balances: BTreeMap<String, u64>,
    pub nonce: u64,
    pub registered: bool,
}
#[near(serializers=[json])]
#[derive(Clone)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    pub from: AccountId,
    pub to: AccountId,
    pub token_id: String,
    pub amount: u64,
}
#[near(serializers=[json])]
#[derive(Clone)]
#[serde(rename_all = "camelCase")]
pub struct Mint {
    pub to: AccountId,
    pub token_id: String,
    pub amount: u64,
    pub reason: String,
}
#[near(serializers=[json])]
#[derive(Clone)]
#[serde(rename_all = "camelCase")]
pub struct Burn {
    pub from: AccountId,
    pub token_id: String,
    pub amount: u64,
    pub reason: String,
}
#[near(serializers=[json])]
#[derive(Clone)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub account_id: AccountId,
    pub action: String,
    pub nonce: u64,
    pub created_at: u64,
    pub expires_at: u64,
    pub transfers: Vec<Transfer>,
    pub mints: Vec<Mint>,
    pub burns: Vec<Burn>,
    #[serde(default)]
    pub station_effects: Vec<StationEffect>,
    pub metadata: near_sdk::serde_json::Value,
}
#[near(serializers=[borsh,json])]
#[derive(Clone)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub id: String,
    pub account_id: AccountId,
    pub nonce: u64,
    pub block_height: u64,
    pub timestamp: u64,
    pub action: String,
    pub plan_hash: String,
}
#[near(serializers=[json])]
pub struct Seed {
    pub account_id: AccountId,
    pub balances: BTreeMap<String, u64>,
    pub public_key: PublicKey,
}
#[near(serializers=[json])]
pub struct Token {
    pub token_id: String,
    pub owner_id: Option<AccountId>,
}
#[near(serializers=[borsh,json])]
#[derive(Clone)]
pub struct GameAuthority {
    pub expires_at: u64,
    pub spend_limit: u64,
    pub spent: u64,
    pub revoked: bool,
    pub authorized_at: u64,
    pub issued_at: u64,
}
#[near(serializers=[json])]
#[serde(rename_all = "camelCase")]
pub struct AuthorityPermit {
    pub account_id: AccountId,
    pub contract_id: AccountId,
    pub network: String,
    pub expires_at: u64,
    pub spend_limit: u64,
    pub created_at: u64,
}
#[near(serializers=[json])]
#[serde(rename_all = "camelCase")]
pub struct RevocationPermit {
    pub account_id: AccountId,
    pub contract_id: AccountId,
    pub network: String,
    pub authorized_at: u64,
    pub last_accepted_nonce: u64,
    pub created_at: u64,
}
#[near(serializers=[borsh,json])]
#[derive(Clone)]
pub struct StationTank {
    pub owner_id: AccountId,
    pub petrol: u64,
    pub capacity: u64,
}
#[near(serializers=[json])]
#[derive(Clone)]
#[serde(rename_all = "camelCase")]
pub struct StationEffect {
    pub station_id: String,
    pub owner_id: AccountId,
    pub petrol_delta: i64,
}
#[near(serializers=[json])]
#[serde(rename_all = "camelCase")]
pub struct WorldBatch {
    pub id: String,
    pub sequence: u64,
    pub previous_sequence: u64,
    pub plans: Vec<Plan>,
    pub created_at: u64,
}
#[near(serializers=[json])]
pub struct MayorApproval {
    pub account_id: AccountId,
    pub signature: Base64VecU8,
}
#[near(serializers=[borsh,json])]
#[derive(Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatchReceipt {
    pub id: String,
    pub sequence: u64,
    pub batch_hash: String,
    pub block_height: u64,
    pub timestamp: u64,
}
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Worldo {
    owner: AccountId,
    oracle: AccountId,
    oracle_key: PublicKey,
    network: String,
    cities: Vec<AccountId>,
    paused: bool,
    accounts: LookupMap<AccountId, Holding>,
    supply: LookupMap<String, u64>,
    receipts: LookupMap<String, Receipt>,
    equipment_issued: LookupMap<String, bool>,
    token_owners: LookupMap<String, AccountId>,
    last_tick_nonce: u64,
    prices: LookupMap<AccountId, BTreeMap<String, u64>>,
    coin_supply: u64,
    authorities: LookupMap<AccountId, GameAuthority>,
    authority_history: LookupMap<String, GameAuthority>,
    revocations: LookupMap<String, u64>,
    stations: LookupMap<String, StationTank>,
    locked_petrol: LookupMap<AccountId, u64>,
    mayor_keys: LookupMap<AccountId, PublicKey>,
    batches: LookupMap<String, BatchReceipt>,
    batch_sequence: u64,
    ledger_accounts: Vector<AccountId>,
    ledger_revision: u64,
    batch_mode: bool,
    receipt_slots: LookupMap<u16, String>,
    batch_slots: LookupMap<u16, String>,
}
#[near]
impl Worldo {
    #[init]
    pub fn new(
        owner: AccountId,
        oracle: AccountId,
        oracle_key: PublicKey,
        network: String,
        cities: Vec<Seed>,
        starter_pool: u64,
    ) -> Self {
        require!(
            owner == env::current_account_id() && env::predecessor_account_id() == owner,
            "Only contract account can initialize"
        );
        require!(
            ["testnet", "mainnet"].contains(&network.as_str()),
            "Invalid network"
        );
        require!(
            oracle_key.curve_type() == near_sdk::CurveType::ED25519,
            "Oracle must use Ed25519"
        );
        require!(
            cities.len() == 3 && starter_pool >= 100 && starter_pool <= 10_000_000,
            "Invalid opening pools"
        );
        let mut s = Self {
            owner,
            oracle,
            oracle_key,
            network,
            cities: vec![],
            paused: false,
            accounts: LookupMap::new(b"a"),
            supply: LookupMap::new(b"s"),
            receipts: LookupMap::new(b"r"),
            equipment_issued: LookupMap::new(b"e"),
            token_owners: LookupMap::new(b"o"),
            last_tick_nonce: 0,
            prices: LookupMap::new(b"p"),
            coin_supply: 0,
            authorities: LookupMap::new(b"g"),
            authority_history: LookupMap::new(b"h"),
            revocations: LookupMap::new(b"j"),
            stations: LookupMap::new(b"v"),
            locked_petrol: LookupMap::new(b"l"),
            mayor_keys: LookupMap::new(b"y"),
            batches: LookupMap::new(b"b"),
            batch_sequence: 0,
            ledger_accounts: Vector::new(b"i"),
            ledger_revision: 0,
            batch_mode: false,
            receipt_slots: LookupMap::new(b"q"),
            batch_slots: LookupMap::new(b"z"),
        };
        let pool = env::current_account_id();
        s.ledger_accounts.push(pool.clone());
        s.accounts.insert(
            pool.clone(),
            Holding {
                registered: true,
                ..Holding::default()
            },
        );
        s.mint(&pool, "coin", starter_pool);
        for seed in cities {
            require!(
                !s.cities.contains(&seed.account_id) && seed.account_id != pool,
                "Duplicate city"
            );
            require!(
                seed.public_key.curve_type() == near_sdk::CurveType::ED25519,
                "Mayor must use Ed25519"
            );
            s.cities.push(seed.account_id.clone());
            s.ledger_accounts.push(seed.account_id.clone());
            s.mayor_keys
                .insert(seed.account_id.clone(), seed.public_key);
            s.accounts.insert(
                seed.account_id.clone(),
                Holding {
                    registered: true,
                    ..Holding::default()
                },
            );
            require!(seed.balances.len() <= 20, "Too many seed tokens");
            for (token, amount) in seed.balances {
                require!(
                    Self::valid_token(&token) && amount <= MAX_AMOUNT,
                    "Invalid seed"
                );
                s.mint(&seed.account_id, &token, amount);
            }
        }
        s.coin_supply = s.total("coin");
        s
    }
    /// Explicit onboarding authorization. It permits only this contract's game
    /// asset ledger, never native NEAR transfers or another application. NEP-366
    /// preserves the player predecessor but uses the relayer as signer.
    pub fn authorize_game(
        &mut self,
        authorization: String,
        signature: Base64VecU8,
    ) -> GameAuthority {
        let account = env::predecessor_account_id();
        require!(
            !self.is_city(&account) && account != env::current_account_id(),
            "Only player account"
        );
        require!(authorization.len() <= 1024, "Authorization too large");
        let sig: [u8; 64] = signature.0.try_into().expect("Invalid oracle signature");
        let key: [u8; 32] = self.oracle_key.as_bytes()[1..].try_into().unwrap();
        require!(
            env::ed25519_verify(&sig, authorization.as_bytes(), &key),
            "Invalid authority permit"
        );
        let p: AuthorityPermit =
            near_sdk::serde_json::from_str(&authorization).expect("Invalid authority permit");
        let now = env::block_timestamp_ms();
        require!(
            p.account_id == account
                && p.contract_id == env::current_account_id()
                && p.network == self.network,
            "Authority scope mismatch"
        );
        require!(
            p.created_at <= now + 5000 && now <= p.created_at + 300000,
            "Authority permit expired"
        );
        require!(
            self.authorities
                .get(&account)
                .map_or(true, |g| p.created_at > g.issued_at),
            "Authority permit replay"
        );
        require!(
            p.expires_at > now
                && p.expires_at <= now + 31 * 86_400_000
                && p.spend_limit > 0
                && p.spend_limit <= 1_000_000,
            "Invalid game authority bounds"
        );
        let grant = GameAuthority {
            expires_at: p.expires_at,
            spend_limit: p.spend_limit,
            spent: 0,
            revoked: false,
            authorized_at: now,
            issued_at: p.created_at,
        };
        self.authority_history.insert(
            format!("{}:{}", account, grant.authorized_at),
            grant.clone(),
        );
        self.authorities.insert(account, grant.clone());
        grant
    }
    pub fn revoke_game(&mut self, revocation: String, signature: Base64VecU8) {
        let account = env::predecessor_account_id();
        require!(revocation.len() <= 1024, "Revocation too large");
        let sig: [u8; 64] = signature.0.try_into().expect("Invalid oracle signature");
        let key: [u8; 32] = self.oracle_key.as_bytes()[1..].try_into().unwrap();
        require!(
            env::ed25519_verify(&sig, revocation.as_bytes(), &key),
            "Invalid revocation permit"
        );
        let p: RevocationPermit =
            near_sdk::serde_json::from_str(&revocation).expect("Invalid revocation permit");
        let now = env::block_timestamp_ms();
        require!(
            p.account_id == account
                && p.contract_id == env::current_account_id()
                && p.network == self.network,
            "Revocation scope mismatch"
        );
        require!(
            p.created_at <= now + 5000 && now <= p.created_at + 300000,
            "Revocation permit expired"
        );
        let epoch = format!("{}:{}", account, p.authorized_at);
        let mut grant = self
            .authority_history
            .get(&epoch)
            .cloned()
            .expect("No game authority");
        require!(!grant.revoked, "Authority already revoked");
        grant.revoked = true;
        self.revocations
            .insert(epoch.clone(), p.last_accepted_nonce);
        self.authority_history.insert(epoch, grant.clone());
        if self
            .authorities
            .get(&account)
            .is_some_and(|g| g.authorized_at == p.authorized_at)
        {
            self.authorities.insert(account, grant);
        }
    }
    pub fn game_authority(&self, account_id: AccountId) -> Option<GameAuthority> {
        self.authorities.get(&account_id).cloned()
    }
    pub fn station_tank(&self, station_id: String) -> Option<StationTank> {
        self.stations.get(&station_id).cloned()
    }
    pub fn accounts_page(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<AccountId> {
        let start = from_index.unwrap_or(0);
        let count = limit.unwrap_or(50).min(100);
        (start..start.saturating_add(count).min(self.ledger_accounts.len()))
            .filter_map(|i| self.ledger_accounts.get(i).cloned())
            .collect()
    }
    pub fn ledger_version(&self) -> u64 {
        self.ledger_revision
    }
    pub fn batch_receipt(&self, id: String) -> Option<BatchReceipt> {
        self.batches.get(&id).cloned()
    }
    pub fn apply_batch(
        &mut self,
        batch: String,
        mayor_approvals: Vec<MayorApproval>,
    ) -> BatchReceipt {
        require!(
            !self.paused && env::predecessor_account_id() == self.oracle,
            "Only city oracle"
        );
        require!(batch.len() <= 196_608, "Batch too large");
        let value: near_sdk::serde_json::Value =
            near_sdk::serde_json::from_str(&batch).expect("Invalid batch");
        let hash = env::sha256(batch.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let b: WorldBatch = near_sdk::serde_json::from_value(value).expect("Invalid batch schema");
        require!(
            b.id.len() >= 8 && b.id.len() <= 128 && !self.batches.contains_key(&b.id),
            "Batch replay"
        );
        require!(
            b.previous_sequence == self.batch_sequence && b.sequence == self.batch_sequence + 1,
            "Batch sequence mismatch"
        );
        require!(
            !b.plans.is_empty()
                && b.plans.len() <= 100
                && b.plans
                    .iter()
                    .map(|p| p.transfers.len()
                        + p.mints.len()
                        + p.burns.len()
                        + p.station_effects.len())
                    .sum::<usize>()
                    <= 512,
            "Too many batch effects"
        );
        let message = format!(
            "Worldo mayor batch\n{}\n{}\n{}\n{}",
            env::current_account_id(),
            self.network,
            b.sequence,
            hash
        );
        require!(mayor_approvals.len() == 3, "All mayor approvals required");
        for city in &self.cities {
            let approval = mayor_approvals
                .iter()
                .find(|a| &a.account_id == city)
                .expect("Missing mayor approval");
            let sig: [u8; 64] = approval
                .signature
                .0
                .clone()
                .try_into()
                .expect("Invalid mayor signature");
            let key: [u8; 32] = self.mayor_keys.get(city).unwrap().as_bytes()[1..]
                .try_into()
                .unwrap();
            require!(
                env::ed25519_verify(&sig, message.as_bytes(), &key),
                "Invalid mayor approval"
            );
        }
        let logs = Self::batch_logs(&b);
        require!(
            logs.iter().map(String::len).sum::<usize>() <= 14_000,
            "Batch event budget exceeded"
        );
        self.batch_mode = true;
        for p in b.plans {
            let tick = p.action == "tick";
            if !tick {
                let epoch = p
                    .metadata
                    .get("authorizationAt")
                    .and_then(|v| v.as_u64())
                    .expect("Missing game authority epoch");
                let authority_id = format!("{}:{}", p.account_id, epoch);
                let mut grant = self
                    .authority_history
                    .get(&authority_id)
                    .cloned()
                    .expect("Authorize Worldo gameplay first");
                require!(
                    self.revocations
                        .get(&authority_id)
                        .map_or(!grant.revoked, |cutoff| p.nonce <= *cutoff),
                    "Game authority revoked"
                );
                require!(
                    p.created_at >= grant.authorized_at.saturating_sub(5000)
                        && p.created_at <= grant.expires_at,
                    "Game authority expired"
                );
                let debit = p
                    .transfers
                    .iter()
                    .filter(|t| t.from == p.account_id && t.token_id == "coin")
                    .try_fold(0u64, |n, t| n.checked_add(t.amount))
                    .expect("Spend overflow");
                grant.spent = grant.spent.checked_add(debit).expect("Spend overflow");
                require!(
                    grant.spent <= grant.spend_limit,
                    "Game authority spending limit"
                );
                self.authority_history.insert(authority_id, grant.clone());
                if self
                    .authorities
                    .get(&p.account_id)
                    .is_some_and(|g| g.authorized_at == epoch)
                {
                    self.authorities.insert(p.account_id.clone(), grant);
                }
            }
            self.apply_plan(p, tick);
        }
        self.batch_mode = false;
        for log in logs {
            env::log_str(&log);
        }
        self.batch_sequence = b.sequence;
        let receipt = BatchReceipt {
            id: b.id.clone(),
            sequence: b.sequence,
            batch_hash: hash,
            block_height: env::block_height(),
            timestamp: env::block_timestamp_ms(),
        };
        let slot = (b.sequence % BATCH_HISTORY) as u16;
        if let Some(old) = self.batch_slots.insert(slot, b.id.clone()) {
            self.batches.remove(&old);
        }
        self.batches.insert(b.id, receipt.clone());
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({"standard":"worldo","version":"2.0.0","event":"batch","data":[receipt]})
        ));
        receipt
    }
    pub fn is_paused(&self) -> bool {
        self.paused
    }
    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
    }
    pub fn set_oracle(&mut self, oracle: AccountId, oracle_key: PublicKey) {
        self.assert_owner();
        require!(
            oracle_key.curve_type() == near_sdk::CurveType::ED25519,
            "Ed25519 oracle required"
        );
        self.oracle = oracle;
        self.oracle_key = oracle_key;
    }
    /// Each mayor publishes its own bounded prices; the simulation supplies prices.
    pub fn set_prices(&mut self, prices: BTreeMap<String, u64>) {
        let city = env::predecessor_account_id();
        require!(self.is_city(&city), "Only mayor");
        require!(
            prices.len() <= 20
                && prices
                    .iter()
                    .all(|(t, p)| Self::valid_token(t) && *p > 0 && *p <= 100_000),
            "Invalid prices"
        );
        self.prices.insert(city, prices);
    }
    pub fn settlement(&self, id: String) -> Option<Receipt> {
        self.receipts.get(&id).cloned()
    }
    pub fn account(&self, account_id: AccountId) -> Option<Holding> {
        self.accounts.get(&account_id).cloned()
    }
    pub fn city_accounts(&self) -> Vec<AccountId> {
        self.cities.clone()
    }
    pub fn city_key(&self, account_id: AccountId) -> Option<PublicKey> {
        self.mayor_keys.get(&account_id).cloned()
    }
    pub fn city_prices(&self, account_id: AccountId) -> Option<BTreeMap<String, u64>> {
        self.prices.get(&account_id).cloned()
    }
    pub fn configuration(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({"version":2,"network":self.network,"oracle":self.oracle,"oracleKey":self.oracle_key,"cities":{"refinery":self.cities[0],"motor":self.cities[1],"harbor":self.cities[2]},"starterPool":env::current_account_id(),"coinSupply":self.coin_supply,"lastTickNonce":self.last_tick_nonce,"batchSequence":self.batch_sequence,"ledgerRevision":self.ledger_revision,"assetTransferMode":"game-ledger"})
    }
    // Game assets remain in the ordered game ledger. Direct wallet transfers
    // cannot race game actions already accepted into the durable outbox.
    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    ) {
        near_sdk::assert_one_yocto();
        require!(approval.is_none(), "Approvals unsupported");
        require!(
            memo.as_ref().map_or(true, |m| m.len() <= 256),
            "Memo too long"
        );
        self.assert_external_transfer_available();
        self.transfer(
            &env::predecessor_account_id(),
            &receiver_id,
            &token_id,
            amount.0.try_into().expect("Amount too large"),
        );
    }
    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    ) {
        near_sdk::assert_one_yocto();
        require!(
            !token_ids.is_empty() && token_ids.len() <= 32 && token_ids.len() == amounts.len(),
            "Invalid batch"
        );
        require!(
            approvals
                .as_ref()
                .map_or(true, |a| a.len() == token_ids.len()
                    && a.iter().all(Option::is_none)),
            "Approvals unsupported"
        );
        require!(
            memo.as_ref().map_or(true, |m| m.len() <= 256),
            "Memo too long"
        );
        self.assert_external_transfer_available();
        for (t, a) in token_ids.iter().zip(amounts) {
            self.transfer(
                &env::predecessor_account_id(),
                &receiver_id,
                t,
                a.0.try_into().expect("Amount too large"),
            );
        }
    }
    #[payable]
    pub fn mt_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
        msg: String,
    ) -> Promise {
        require!(approval.is_none(), "Approval extension is not supported");
        self.mt_batch_transfer_call(receiver_id, vec![token_id], vec![amount], None, memo, msg)
    }
    #[payable]
    pub fn mt_batch_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
        msg: String,
    ) -> Promise {
        near_sdk::assert_one_yocto();
        require!(!self.paused, "Economy paused");
        require!(
            approvals
                .as_ref()
                .map_or(true, |a| a.len() == token_ids.len()
                    && a.iter().all(Option::is_none)),
            "Approvals unsupported"
        );
        require!(
            !token_ids.is_empty() && token_ids.len() <= 32 && token_ids.len() == amounts.len(),
            "Invalid batch"
        );
        require!(
            msg.len() <= 4096 && memo.as_ref().map_or(true, |s| s.len() <= 256),
            "Message too long"
        );
        require!(
            env::prepaid_gas().as_gas() >= 80_000_000_000_000,
            "Attach at least 80 TGas"
        );
        self.assert_external_transfer_available();
        let sender_id = env::predecessor_account_id();
        for (token, amount) in token_ids.iter().zip(&amounts) {
            self.transfer(
                &sender_id,
                &receiver_id,
                token,
                amount.0.try_into().expect("Amount too large"),
            );
        }
        let args=near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"sender_id":sender_id,"previous_owner_ids":vec![sender_id.clone();token_ids.len()],"token_ids":token_ids,"amounts":amounts,"msg":msg})).unwrap();
        Promise::new(receiver_id.clone())
            .function_call(
                "mt_on_transfer",
                args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(40),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(20))
                    .mt_resolve_transfer(sender_id, receiver_id, token_ids, amounts),
            )
    }
    #[private]
    pub fn mt_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
    ) -> Vec<U128> {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Only this contract can resolve transfers"
        );
        require!(
            token_ids.len() == amounts.len() && token_ids.len() <= 32,
            "Invalid resolution"
        );
        let unused = match env::promise_result_checked(0, 1024) {
            Ok(bytes) => near_sdk::serde_json::from_slice::<Vec<U128>>(&bytes)
                .ok()
                .filter(|v| v.len() == amounts.len())
                .unwrap_or_else(|| amounts.clone()),
            _ => amounts.clone(),
        };
        // Receiver may have spent some tokens in another receipt. Refund only
        // the unspent balance, bounded by both the original and returned amount.
        token_ids
            .iter()
            .zip(amounts.iter())
            .zip(unused.iter())
            .map(|((token, amount), unused)| {
                let available = self.balance(&receiver_id, token) as u128;
                let refund = amount.0.min(unused.0).min(available);
                if refund > 0 {
                    self.transfer(
                        &receiver_id,
                        &sender_id,
                        token,
                        refund.try_into().expect("Amount too large"),
                    );
                }
                U128(amount.0 - refund)
            })
            .collect()
    }
    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(self.balance(&account_id, &token_id) as u128)
    }
    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        require!(token_ids.len() <= 64, "Too many tokens");
        token_ids
            .iter()
            .map(|t| U128(self.balance(&account_id, t) as u128))
            .collect()
    }
    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        self.supply.get(&token_id).map(|n| U128(*n as u128))
    }
    pub fn mt_batch_supply(&self, token_ids: Vec<String>) -> Vec<Option<U128>> {
        require!(token_ids.len() <= 64, "Too many tokens");
        token_ids.into_iter().map(|t| self.mt_supply(t)).collect()
    }
    pub fn mt_token(&self, token_ids: Vec<String>) -> Vec<Option<Token>> {
        require!(token_ids.len() <= 64, "Too many tokens");
        token_ids
            .into_iter()
            .map(|token_id| {
                self.supply.get(&token_id).map(|_| Token {
                    owner_id: self.token_owners.get(&token_id).cloned(),
                    token_id,
                })
            })
            .collect()
    }
}
impl Worldo {
    fn apply_plan(&mut self, p: Plan, tick: bool) -> Receipt {
        let canonical =
            near_sdk::serde_json::to_vec(&near_sdk::serde_json::to_value(&p).unwrap()).unwrap();
        let plan_hash = env::sha256(&canonical)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        require!(
            p.id.len() >= 8 && p.id.len() <= 128 && !self.receipts.contains_key(&p.id),
            "Settlement replay"
        );
        require!(
            p.transfers.len() + p.mints.len() + p.burns.len() + p.station_effects.len()
                <= MAX_EFFECTS,
            "Too many effects"
        );
        if tick {
            require!(p.nonce > self.last_tick_nonce, "Tick nonce replay");
            self.last_tick_nonce = p.nonce;
        }
        if !tick {
            require!(
                !self.is_city(&p.account_id) && p.account_id != env::current_account_id(),
                "Invalid player"
            );
            let old = self
                .accounts
                .get(&p.account_id)
                .cloned()
                .unwrap_or_default();
            require!(p.nonce > old.nonce, "Player nonce replay");
            if p.action == "register" {
                require!(!old.registered, "Already registered");
                require!(
                    p.transfers.len() == 1
                        && p.transfers[0].from == env::current_account_id()
                        && p.transfers[0].to == p.account_id
                        && p.transfers[0].token_id == "coin"
                        && p.transfers[0].amount == 100,
                    "Invalid starter grant"
                );
                require!(
                    p.burns.is_empty() && p.mints.len() == 4,
                    "Invalid starter items"
                );
                for kind in ["hand_pump", "tapping_knife", "axe", "hand_cart"] {
                    let token = format!("equipment:{}:{}:0", p.account_id, kind);
                    require!(
                        p.mints.iter().any(|m| m.token_id == token
                            && m.to == p.account_id
                            && m.amount == 1
                            && m.reason == "starter"),
                        "Invalid starter equipment"
                    );
                }
                self.ledger_accounts.push(p.account_id.clone());
                self.accounts.insert(
                    p.account_id.clone(),
                    Holding {
                        registered: true,
                        ..Holding::default()
                    },
                );
            } else {
                require!(old.registered, "Register first");
            }
        }
        if p.action == "station_upgrade" {
            let station_id = p
                .metadata
                .get("stationId")
                .and_then(|v| v.as_str())
                .expect("Missing station upgrade");
            let mut tank = self
                .stations
                .get(station_id)
                .cloned()
                .expect("Unknown station");
            require!(
                tank.owner_id == p.account_id && tank.capacity == 500,
                "Station upgrade unavailable"
            );
            tank.capacity = 1000;
            self.stations.insert(station_id.into(), tank);
        }
        let mut station_out: BTreeMap<AccountId, u64> = BTreeMap::new();
        let mut seen_stations = std::collections::BTreeSet::new();
        for effect in &p.station_effects {
            require!(
                seen_stations.insert(effect.station_id.clone()),
                "Repeated station effect"
            );
            let mut tank = self
                .stations
                .get(&effect.station_id)
                .cloned()
                .expect("Unknown station");
            require!(
                tank.owner_id == effect.owner_id
                    && self.balance(&effect.owner_id, &effect.station_id) == 1,
                "Station ownership mismatch"
            );
            if effect.petrol_delta > 0 {
                require!(
                    !tick && p.action == "station_stock" && p.account_id == effect.owner_id,
                    "Only owner can stock station"
                );
            } else {
                require!(
                    effect.petrol_delta < 0 && tick,
                    "Only station sales consume allocation"
                );
                *station_out.entry(effect.owner_id.clone()).or_default() +=
                    effect.petrol_delta.unsigned_abs();
            }
            let next = tank.petrol as i128 + effect.petrol_delta as i128;
            require!(
                next >= 0 && next <= tank.capacity as i128,
                "Invalid station tank allocation"
            );
            let locked = self
                .locked_petrol
                .get(&effect.owner_id)
                .copied()
                .unwrap_or(0) as i128
                + effect.petrol_delta as i128;
            require!(locked >= 0, "Invalid locked petrol");
            tank.petrol = next as u64;
            self.locked_petrol
                .insert(effect.owner_id.clone(), locked as u64);
            self.stations.insert(effect.station_id.clone(), tank);
        }
        let mut offline_debits: BTreeMap<AccountId, u64> = BTreeMap::new();
        for t in &p.transfers {
            require!(
                t.amount > 0 && t.amount <= MAX_AMOUNT && Self::valid_token(&t.token_id),
                "Invalid transfer"
            );
            if tick {
                let city_transfer = self.is_city(&t.from)
                    && (self.is_city(&t.to)
                        || t.to == env::current_account_id()
                        || self.accounts.get(&t.to).is_some_and(|a| a.registered));
                let driver_payment = t.from == env::current_account_id()
                    && t.token_id == "coin"
                    && (self.is_city(&t.to)
                        || self.accounts.get(&t.to).is_some_and(|a| a.registered));
                let station_delivery = station_out.contains_key(&t.from)
                    && self.is_city(&t.to)
                    && t.token_id == "petrol";
                require!(
                    city_transfer || driver_payment || station_delivery,
                    "Tick cannot spend unrestricted player assets"
                );
                if station_delivery {
                    *offline_debits.entry(t.from.clone()).or_default() += t.amount;
                }
            } else {
                require!(
                    (t.from == p.account_id
                        || self.is_city(&t.from)
                        || (p.action == "register" && t.from == env::current_account_id()))
                        && (t.to == p.account_id || self.is_city(&t.to)),
                    "Unrelated account in settlement"
                );
            }
        }
        for m in &p.mints {
            require!(
                m.amount > 0
                    && m.amount <= MAX_AMOUNT
                    && m.token_id != "coin"
                    && Self::valid_token(&m.token_id),
                "Invalid mint"
            );
            match m.reason.as_str() {
                "harvest" => {
                    let sale = !tick
                        && ["sell", "contract_deliver"].contains(&p.action.as_str())
                        && Self::raw(&m.token_id)
                        && self.is_city(&m.to);
                    let construction = !tick
                        && ["station_build", "station_repair", "station_upgrade"]
                            .contains(&p.action.as_str())
                        && m.to == p.account_id
                        && ["wood", "rubber"].contains(&m.token_id.as_str())
                        && p.burns
                            .iter()
                            .filter(|b| b.from == m.to && b.token_id == m.token_id)
                            .map(|b| b.amount)
                            .sum::<u64>()
                            >= m.amount;
                    require!(sale || construction, "Harvest only at sale or station use");
                }
                "manufacture" => {
                    let equipment = tick
                        && self.is_city(&m.to)
                        && (m.token_id == "petrol" || m.token_id.starts_with("equipment:"));
                    let deed = !tick
                        && p.action == "station_buy"
                        && m.to == p.account_id
                        && m.amount == 1
                        && Self::valid_station(&m.token_id);
                    require!(equipment || deed, "Invalid manufacture");
                    if deed {
                        require!(
                            !self.stations.contains_key(&m.token_id),
                            "Station already owned"
                        );
                        let city_prefix = m.token_id.rsplit_once(':').unwrap().0;
                        require!(
                            (1..=2)
                                .all(|slot| self.balance(&m.to, &format!("{city_prefix}:{slot}"))
                                    == 0),
                            "One station per city"
                        );
                        self.stations.insert(
                            m.token_id.clone(),
                            StationTank {
                                owner_id: m.to.clone(),
                                petrol: 0,
                                capacity: 500,
                            },
                        );
                    }
                }
                "starter" => require!(
                    !tick
                        && p.action == "register"
                        && m.to == p.account_id
                        && m.token_id.starts_with("equipment:"),
                    "Invalid starter mint"
                ),
                _ => env::panic_str("Unknown mint reason"),
            };
        }
        for b in &p.burns {
            require!(
                b.amount > 0
                    && b.amount <= MAX_AMOUNT
                    && b.token_id != "coin"
                    && Self::valid_token(&b.token_id),
                "Invalid burn"
            );
            if tick && !self.is_city(&b.from) {
                require!(
                    b.token_id == "petrol" && station_out.contains_key(&b.from),
                    "Only allocated station fuel may be sold offline"
                );
                *offline_debits.entry(b.from.clone()).or_default() += b.amount;
            } else {
                require!(
                    if tick {
                        self.is_city(&b.from)
                    } else {
                        b.from == p.account_id || self.is_city(&b.from)
                    },
                    "Unrelated burn"
                );
            }
            require!(
                ["fuel", "production", "construction"].contains(&b.reason.as_str()),
                "Unknown burn reason"
            );
        }
        require!(
            offline_debits == station_out,
            "Station sales must exactly consume allocated petrol"
        );
        // A tick represents multiple simulation steps. Validate final net deltas so
        // a city can spend income earned earlier in that same atomic batch.
        let mut deltas: BTreeMap<(AccountId, String), i128> = BTreeMap::new();
        let mut supplies: BTreeMap<String, i128> = BTreeMap::new();
        for m in &p.mints {
            if m.token_id.starts_with("equipment:") || m.token_id.starts_with("station:") {
                require!(
                    m.amount == 1 && !self.equipment_issued.contains_key(&m.token_id),
                    "Equipment instance already issued"
                );
                self.equipment_issued.insert(m.token_id.clone(), true);
                self.token_owners.insert(m.token_id.clone(), m.to.clone());
            }
            *deltas
                .entry((m.to.clone(), m.token_id.clone()))
                .or_default() += m.amount as i128;
            *supplies.entry(m.token_id.clone()).or_default() += m.amount as i128;
        }
        for t in &p.transfers {
            require!(t.from != t.to, "Self transfer");
            *deltas
                .entry((t.from.clone(), t.token_id.clone()))
                .or_default() -= t.amount as i128;
            *deltas
                .entry((t.to.clone(), t.token_id.clone()))
                .or_default() += t.amount as i128;
        }
        for b in &p.burns {
            *deltas
                .entry((b.from.clone(), b.token_id.clone()))
                .or_default() -= b.amount as i128;
            *supplies.entry(b.token_id.clone()).or_default() -= b.amount as i128;
        }
        for ((id, token), delta) in deltas {
            let a = self
                .accounts
                .get_mut(&id)
                .expect("Unknown settlement account");
            let next = a.balances.get(&token).copied().unwrap_or(0) as i128 + delta;
            require!(
                next >= 0 && next <= u64::MAX as i128,
                "Insufficient settlement balance"
            );
            if token == "petrol" {
                require!(
                    next >= self.locked_petrol.get(&id).copied().unwrap_or(0) as i128,
                    "Petrol is allocated to a station"
                );
            }
            a.balances.insert(token, next as u64);
        }
        for t in &p.transfers {
            if t.token_id.starts_with("equipment:") || Self::valid_station(&t.token_id) {
                self.token_owners.insert(t.token_id.clone(), t.to.clone());
            }
        }
        for (token, delta) in supplies {
            let next = self.total(&token) as i128 + delta;
            require!(next >= 0 && next <= u64::MAX as i128, "Invalid supply");
            self.supply.insert(token, next as u64);
        }
        if !self.batch_mode {
            for m in &p.mints {
                Self::event(
                    "mt_mint",
                    near_sdk::serde_json::json!([{ "owner_id":m.to,"token_ids":[m.token_id],"amounts":[U128(m.amount as u128)]}]),
                );
            }
            for t in &p.transfers {
                Self::event(
                    "mt_transfer",
                    near_sdk::serde_json::json!([{ "old_owner_id":t.from,"new_owner_id":t.to,"token_ids":[t.token_id],"amounts":[U128(t.amount as u128)]}]),
                );
            }
            for b in &p.burns {
                Self::event(
                    "mt_burn",
                    near_sdk::serde_json::json!([{ "owner_id":b.from,"token_ids":[b.token_id],"amounts":[U128(b.amount as u128)]}]),
                );
            }
        }
        for effect in &p.station_effects {
            require!(
                self.balance(&effect.owner_id, "petrol")
                    >= self
                        .locked_petrol
                        .get(&effect.owner_id)
                        .copied()
                        .unwrap_or(0),
                "Station stock exceeds owned petrol"
            );
        }
        require!(self.total("coin") == self.coin_supply, "Coin conservation");
        if !tick {
            let a = self.accounts.get_mut(&p.account_id).unwrap();
            a.nonce = p.nonce;
        }
        self.ledger_revision += 1;
        let receipt = Receipt {
            id: p.id.clone(),
            account_id: p.account_id,
            nonce: p.nonce,
            block_height: env::block_height(),
            timestamp: env::block_timestamp_ms(),
            action: p.action,
            plan_hash,
        };
        let slot = (self.ledger_revision % RECEIPT_HISTORY) as u16;
        if let Some(old) = self.receipt_slots.insert(slot, p.id.clone()) {
            self.receipts.remove(&old);
        }
        self.receipts.insert(p.id, receipt.clone());
        if !self.batch_mode {
            env::log_str(&format!(
                "EVENT_JSON:{}",
                near_sdk::serde_json::json!({"standard":"worldo","version":"2.0.0","event":"settlement","data":[receipt]})
            ));
        }
        receipt
    }
    fn batch_logs(b: &WorldBatch) -> Vec<String> {
        let mut mints: BTreeMap<AccountId, BTreeMap<String, u64>> = BTreeMap::new();
        let mut burns: BTreeMap<AccountId, BTreeMap<String, u64>> = BTreeMap::new();
        let mut transfers: BTreeMap<(AccountId, AccountId), BTreeMap<String, u64>> =
            BTreeMap::new();
        let mut mayors: Option<near_sdk::serde_json::Value> = None;
        for p in &b.plans {
            for m in &p.mints {
                *mints
                    .entry(m.to.clone())
                    .or_default()
                    .entry(m.token_id.clone())
                    .or_default() += m.amount;
            }
            for burn in &p.burns {
                *burns
                    .entry(burn.from.clone())
                    .or_default()
                    .entry(burn.token_id.clone())
                    .or_default() += burn.amount;
            }
            for t in &p.transfers {
                *transfers
                    .entry((t.from.clone(), t.to.clone()))
                    .or_default()
                    .entry(t.token_id.clone())
                    .or_default() += t.amount;
            }
            if let Some(raw) = p.metadata.get("mayorRecords").and_then(|v| v.as_str()) {
                mayors = near_sdk::serde_json::from_str(raw).ok();
            }
        }
        let mut logs = vec![];
        let format = |event: &str, data: near_sdk::serde_json::Value| {
            format!(
                "EVENT_JSON:{}",
                near_sdk::serde_json::json!({"standard":"nep245","version":"1.0.0","event":event,"data":data})
            )
        };
        for (event, owners) in [("mt_mint", mints), ("mt_burn", burns)] {
            if !owners.is_empty() {
                let data:Vec<_>=owners.into_iter().map(|(owner,tokens)|near_sdk::serde_json::json!({"owner_id":owner,"token_ids":tokens.keys().collect::<Vec<_>>(),"amounts":tokens.values().map(|n|U128(*n as u128)).collect::<Vec<_>>()})).collect();
                logs.push(format(event, near_sdk::serde_json::json!(data)));
            }
        }
        if !transfers.is_empty() {
            let data:Vec<_>=transfers.into_iter().map(|((from,to),tokens)|near_sdk::serde_json::json!({"old_owner_id":from,"new_owner_id":to,"token_ids":tokens.keys().collect::<Vec<_>>(),"amounts":tokens.values().map(|n|U128(*n as u128)).collect::<Vec<_>>()})).collect();
            logs.push(format("mt_transfer", near_sdk::serde_json::json!(data)));
        }
        if let Some(records) = mayors {
            logs.push(format!("EVENT_JSON:{}",near_sdk::serde_json::json!({"standard":"worldo","version":"2.0.0","event":"mayor_decisions","data":[{"batch_id":b.id,"records":records}]})));
        }
        logs
    }
    fn assert_external_transfer_available(&self) {
        env::panic_str("Game assets are locked to ordered game settlement; direct wallet transfers are unavailable");
    }
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only owner");
    }
    fn is_city(&self, id: &AccountId) -> bool {
        self.cities.contains(id)
    }
    fn raw(token: &str) -> bool {
        ["crude_oil", "rubber", "wood"].contains(&token)
    }
    fn valid_station(token: &str) -> bool {
        [
            "station:refinery:1",
            "station:refinery:2",
            "station:motor:1",
            "station:motor:2",
            "station:harbor:1",
            "station:harbor:2",
        ]
        .contains(&token)
    }
    fn valid_token(token: &str) -> bool {
        ["coin", "crude_oil", "rubber", "wood", "petrol"].contains(&token)
            || Self::valid_station(token)
            || (token.starts_with("equipment:")
                && token.len() <= 192
                && token
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b":._-".contains(&c)))
    }
    fn balance(&self, id: &AccountId, token: &str) -> u64 {
        self.accounts
            .get(id)
            .and_then(|a| a.balances.get(token))
            .copied()
            .unwrap_or(0)
    }
    fn total(&self, token: &str) -> u64 {
        self.supply.get(token).copied().unwrap_or(0)
    }
    fn mint(&mut self, id: &AccountId, token: &str, amount: u64) {
        if amount == 0 {
            return;
        }
        if token.starts_with("equipment:") || token.starts_with("station:") {
            require!(
                amount == 1 && !self.equipment_issued.contains_key(token),
                "Equipment instance already issued"
            );
            self.equipment_issued.insert(token.into(), true);
            self.token_owners.insert(token.into(), id.clone());
        }
        let a = self.accounts.get_mut(id).expect("Unknown recipient");
        let old = a.balances.get(token).copied().unwrap_or(0);
        a.balances.insert(
            token.into(),
            old.checked_add(amount).expect("Balance overflow"),
        );
        self.supply.insert(
            token.into(),
            self.total(token)
                .checked_add(amount)
                .expect("Supply overflow"),
        );
        Self::event(
            "mt_mint",
            near_sdk::serde_json::json!([{ "owner_id":id,"token_ids":[token],"amounts":[U128(amount as u128)]}]),
        );
    }
    fn transfer(&mut self, from: &AccountId, to: &AccountId, token: &str, amount: u64) {
        if Self::valid_station(token) {
            let prefix = token.rsplit_once(':').unwrap().0;
            require!(
                (1..=2).all(|slot| self.balance(to, &format!("{prefix}:{slot}")) == 0),
                "One station per city"
            );
        }
        require!(from != to && amount > 0, "Invalid transfer");
        require!(self.accounts.contains_key(to), "Receiver not registered");
        let a = self.accounts.get_mut(from).expect("Unknown sender");
        let old = a.balances.get(token).copied().unwrap_or(0);
        require!(old >= amount, "Insufficient balance");
        if token == "petrol" {
            require!(
                old - amount >= self.locked_petrol.get(from).copied().unwrap_or(0),
                "Petrol is allocated to a station"
            );
        }
        a.balances.insert(token.into(), old - amount);
        let b = self.accounts.get_mut(to).unwrap();
        let received = b.balances.get(token).copied().unwrap_or(0);
        b.balances.insert(
            token.into(),
            received.checked_add(amount).expect("Balance overflow"),
        );
        if token.starts_with("equipment:") || Self::valid_station(token) {
            self.token_owners.insert(token.into(), to.clone());
        }
        self.ledger_revision += 1;
        Self::event(
            "mt_transfer",
            near_sdk::serde_json::json!([{ "old_owner_id":from,"new_owner_id":to,"token_ids":[token],"amounts":[U128(amount as u128)]}]),
        );
        if Self::valid_station(token) {
            let mut tank = self
                .stations
                .get(token)
                .cloned()
                .expect("Station allocation missing");
            require!(
                tank.owner_id == *from && amount == 1,
                "Invalid deed transfer"
            );
            let held = tank.petrol;
            let from_locked = self.locked_petrol.get(from).copied().unwrap_or(0);
            let to_locked = self.locked_petrol.get(to).copied().unwrap_or(0);
            self.locked_petrol.insert(from.clone(), from_locked - held);
            if held > 0 {
                self.transfer(from, to, "petrol", held);
            }
            self.locked_petrol.insert(to.clone(), to_locked + held);
            tank.owner_id = to.clone();
            self.stations.insert(token.into(), tank);
        }
    }
    fn event(event: &str, data: near_sdk::serde_json::Value) {
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({"standard":"nep245","version":"1.0.0","event":event,"data":data})
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env};
    fn id(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn context(who: &str) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(id("worldo.testnet"))
            .predecessor_account_id(id(who))
            .signer_account_id(id(who))
            .block_timestamp(1_000_000_000_000)
            .block_height(77);
        testing_env!(b.build());
    }
    fn setup() -> Worldo {
        context("worldo.testnet");
        Worldo::new(
            id("worldo.testnet"),
            id("oracle.testnet"),
            "ed25519:11111111111111111111111111111111".parse().unwrap(),
            "testnet".into(),
            ["refinery.testnet", "motor.testnet", "harbor.testnet"]
                .iter()
                .map(|s| Seed {
                    account_id: id(s),
                    balances: BTreeMap::from([("coin".into(), 12000), ("petrol".into(), 100)]),
                    public_key: "ed25519:11111111111111111111111111111111".parse().unwrap(),
                })
                .collect(),
            100000,
        )
    }
    fn plan(action: &str, nonce: u64) -> Plan {
        Plan {
            id: format!("operation-{nonce}"),
            account_id: id("alice.testnet"),
            action: action.into(),
            nonce,
            created_at: 1_000_000,
            expires_at: 1_120_000,
            transfers: vec![],
            mints: vec![],
            burns: vec![],
            station_effects: vec![],
            metadata: near_sdk::serde_json::json!({}),
        }
    }
    fn register(c: &mut Worldo) {
        let mut p = plan("register", 1);
        p.transfers.push(Transfer {
            from: id("worldo.testnet"),
            to: p.account_id.clone(),
            token_id: "coin".into(),
            amount: 100,
        });
        for kind in ["hand_pump", "tapping_knife", "axe", "hand_cart"] {
            p.mints.push(Mint {
                to: p.account_id.clone(),
                token_id: format!("equipment:{}:{kind}:0", p.account_id),
                amount: 1,
                reason: "starter".into(),
            });
        }
        c.apply_plan(p, false);
    }
    #[test]
    fn fixed_supply_and_starters() {
        let mut c = setup();
        register(&mut c);
        assert_eq!(c.total("coin"), 136000);
        assert_eq!(c.balance(&id("worldo.testnet"), "coin"), 99900);
        assert_eq!(c.balance(&id("alice.testnet"), "coin"), 100);
        assert_eq!(c.account(id("alice.testnet")).unwrap().balances.len(), 5);
    }
    #[test]
    fn sale_mints_once_at_city_and_conserves_coins() {
        let mut c = setup();
        register(&mut c);
        let mut p = plan("sell", 2);
        p.mints.push(Mint {
            to: id("refinery.testnet"),
            token_id: "crude_oil".into(),
            amount: 3,
            reason: "harvest".into(),
        });
        p.transfers.push(Transfer {
            from: id("refinery.testnet"),
            to: p.account_id.clone(),
            token_id: "coin".into(),
            amount: 9,
        });
        c.apply_plan(p, false);
        assert_eq!(c.balance(&id("refinery.testnet"), "crude_oil"), 3);
        assert_eq!(c.balance(&id("alice.testnet"), "crude_oil"), 0);
        assert_eq!(c.balance(&id("alice.testnet"), "coin"), 109);
        assert_eq!(c.total("coin"), 136000);
    }
    #[test]
    #[should_panic(expected = "Settlement replay")]
    fn duplicate_operation_rejected() {
        let mut c = setup();
        register(&mut c);
        register(&mut c);
    }
    #[test]
    #[should_panic(expected = "Player nonce replay")]
    fn nonce_replay_rejected() {
        let mut c = setup();
        register(&mut c);
        let mut p = plan("sell", 1);
        p.id = "different-id".into();
        c.apply_plan(p, false);
    }
    #[test]
    #[should_panic(expected = "Invalid mint")]
    fn cannot_mint_coins() {
        let mut c = setup();
        register(&mut c);
        let mut p = plan("sell", 2);
        p.mints.push(Mint {
            to: id("alice.testnet"),
            token_id: "coin".into(),
            amount: 1,
            reason: "harvest".into(),
        });
        c.apply_plan(p, false);
    }
    #[test]
    #[should_panic(expected = "Harvest only at sale or station use")]
    fn mined_goods_cannot_be_minted_to_player() {
        let mut c = setup();
        register(&mut c);
        let mut p = plan("sell", 2);
        p.mints.push(Mint {
            to: id("alice.testnet"),
            token_id: "wood".into(),
            amount: 1,
            reason: "harvest".into(),
        });
        c.apply_plan(p, false);
    }
    #[test]
    #[should_panic(expected = "Unrelated account")]
    fn permit_cannot_debit_another_player() {
        let mut c = setup();
        register(&mut c);
        let mut p = plan("buy", 2);
        p.transfers.push(Transfer {
            from: id("victim.testnet"),
            to: p.account_id.clone(),
            token_id: "coin".into(),
            amount: 1,
        });
        c.apply_plan(p, false);
    }
    #[test]
    fn city_batch_nets_income_before_spending() {
        let mut c = setup();
        let mut p = plan("tick", 1);
        p.account_id = id("oracle.testnet");
        p.transfers = vec![
            Transfer {
                from: id("refinery.testnet"),
                to: id("motor.testnet"),
                token_id: "coin".into(),
                amount: 20000,
            },
            Transfer {
                from: id("motor.testnet"),
                to: id("refinery.testnet"),
                token_id: "coin".into(),
                amount: 20000,
            },
        ];
        context("oracle.testnet");
        c.apply_plan(p, true);
        assert_eq!(c.balance(&id("motor.testnet"), "coin"), 12000);
    }
    #[test]
    #[should_panic(expected = "Only city oracle")]
    fn player_cannot_run_city_batch() {
        let mut c = setup();
        context("alice.testnet");
        c.apply_batch("{}".into(), vec![]);
    }
    #[test]
    fn fuel_burn_reduces_supply_not_coins() {
        let mut c = setup();
        let mut p = plan("tick", 1);
        p.account_id = id("oracle.testnet");
        p.burns.push(Burn {
            from: id("motor.testnet"),
            token_id: "petrol".into(),
            amount: 4,
            reason: "fuel".into(),
        });
        context("oracle.testnet");
        c.apply_plan(p, true);
        assert_eq!(c.total("petrol"), 296);
        assert_eq!(c.total("coin"), 136000);
    }
    #[test]
    #[should_panic(expected = "Only mayor")]
    fn players_cannot_change_city_prices() {
        let mut c = setup();
        context("alice.testnet");
        c.set_prices(BTreeMap::from([("petrol".into(), 1)]));
    }
    fn owned_station(c: &mut Worldo) {
        register(c);
        c.transfer(&id("refinery.testnet"), &id("alice.testnet"), "coin", 1000);
        c.mint(&id("alice.testnet"), "petrol", 10);
        let mut p = plan("station_buy", 2);
        p.transfers.push(Transfer {
            from: p.account_id.clone(),
            to: id("refinery.testnet"),
            token_id: "coin".into(),
            amount: 600,
        });
        p.mints.push(Mint {
            to: p.account_id.clone(),
            token_id: "station:refinery:1".into(),
            amount: 1,
            reason: "manufacture".into(),
        });
        c.apply_plan(p, false);
        let mut stock = plan("station_stock", 3);
        stock.station_effects.push(StationEffect {
            station_id: "station:refinery:1".into(),
            owner_id: stock.account_id.clone(),
            petrol_delta: 5,
        });
        c.apply_plan(stock, false);
    }
    #[test]
    fn offline_sales_only_spend_allocated_tank_and_credit_owner() {
        let mut c = setup();
        owned_station(&mut c);
        let mut p = plan("tick", 4);
        p.account_id = id("city-simulation");
        p.station_effects.push(StationEffect {
            station_id: "station:refinery:1".into(),
            owner_id: id("alice.testnet"),
            petrol_delta: -2,
        });
        p.burns.push(Burn {
            from: id("alice.testnet"),
            token_id: "petrol".into(),
            amount: 1,
            reason: "fuel".into(),
        });
        p.transfers = vec![
            Transfer {
                from: id("alice.testnet"),
                to: id("refinery.testnet"),
                token_id: "petrol".into(),
                amount: 1,
            },
            Transfer {
                from: id("worldo.testnet"),
                to: id("alice.testnet"),
                token_id: "coin".into(),
                amount: 20,
            },
        ];
        c.apply_plan(p, true);
        assert_eq!(
            c.station_tank("station:refinery:1".into()).unwrap().petrol,
            3
        );
        assert_eq!(c.balance(&id("alice.testnet"), "petrol"), 8);
        assert_eq!(c.balance(&id("alice.testnet"), "coin"), 520);
        assert_eq!(c.total("coin"), 136000);
    }
    #[test]
    #[should_panic(expected = "Station stock exceeds owned petrol")]
    fn cannot_lock_petrol_that_is_not_owned() {
        let mut c = setup();
        owned_station(&mut c);
        let mut p = plan("station_stock", 4);
        p.station_effects.push(StationEffect {
            station_id: "station:refinery:1".into(),
            owner_id: p.account_id.clone(),
            petrol_delta: 100,
        });
        c.apply_plan(p, false);
    }
    #[test]
    #[should_panic(expected = "Petrol is allocated to a station")]
    fn external_transfer_cannot_spend_station_fuel() {
        let mut c = setup();
        owned_station(&mut c);
        c.transfer(&id("alice.testnet"), &id("motor.testnet"), "petrol", 6);
    }
    #[test]
    #[should_panic(expected = "Only allocated station fuel")]
    fn offline_tick_cannot_burn_player_cargo() {
        let mut c = setup();
        owned_station(&mut c);
        let mut p = plan("tick", 4);
        p.burns.push(Burn {
            from: id("alice.testnet"),
            token_id: "petrol".into(),
            amount: 1,
            reason: "fuel".into(),
        });
        c.apply_plan(p, true);
    }
    #[test]
    fn transferring_deed_transfers_its_allocated_fuel_with_it() {
        let mut c = setup();
        owned_station(&mut c);
        c.transfer(
            &id("alice.testnet"),
            &id("motor.testnet"),
            "station:refinery:1",
            1,
        );
        let tank = c.station_tank("station:refinery:1".into()).unwrap();
        assert_eq!(tank.owner_id, id("motor.testnet"));
        assert_eq!(tank.petrol, 5);
        assert_eq!(c.balance(&id("alice.testnet"), "petrol"), 5);
        assert_eq!(c.balance(&id("motor.testnet"), "petrol"), 105);
    }

    fn signed_fixture() -> (Worldo, near_sdk::serde_json::Value) {
        let f: near_sdk::serde_json::Value =
            near_sdk::serde_json::from_str(include_str!("../fixtures/signed-batch.json")).unwrap();
        context("worldo.testnet");
        let cities = f["mayors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| Seed {
                account_id: id(m["account_id"].as_str().unwrap()),
                public_key: m["public_key"].as_str().unwrap().parse().unwrap(),
                balances: BTreeMap::from([("coin".into(), 12000)]),
            })
            .collect();
        let c = Worldo::new(
            id("worldo.testnet"),
            id("oracle.testnet"),
            f["oraclePublicKey"].as_str().unwrap().parse().unwrap(),
            "testnet".into(),
            cities,
            100000,
        );
        (c, f)
    }
    fn approve_fixture(c: &mut Worldo, f: &near_sdk::serde_json::Value) {
        context("alice.testnet");
        c.authorize_game(
            f["authorization"].as_str().unwrap().into(),
            near_sdk::serde_json::from_value(f["authorizationSignature"].clone()).unwrap(),
        );
    }
    fn fixture_approvals(f: &near_sdk::serde_json::Value) -> Vec<MayorApproval> {
        f["mayors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| MayorApproval {
                account_id: id(m["account_id"].as_str().unwrap()),
                signature: near_sdk::serde_json::from_value(m["signature"].clone()).unwrap(),
            })
            .collect()
    }
    #[test]
    fn signed_authority_and_three_mayors_settle_exact_batch() {
        let (mut c, f) = signed_fixture();
        approve_fixture(&mut c, &f);
        context("oracle.testnet");
        let receipt = c.apply_batch(f["batch"].as_str().unwrap().into(), fixture_approvals(&f));
        assert_eq!(receipt.batch_hash, f["hash"].as_str().unwrap());
        assert_eq!(c.balance(&id("alice.testnet"), "coin"), 100);
        assert_eq!(c.batch_sequence, 1);
        assert_eq!(c.total("coin"), 136000);
    }
    #[test]
    #[should_panic(expected = "Invalid mayor approval")]
    fn modifying_signed_batch_invalidates_mayor_signatures() {
        let (mut c, f) = signed_fixture();
        approve_fixture(&mut c, &f);
        context("oracle.testnet");
        let changed = f["batch"]
            .as_str()
            .unwrap()
            .replace("signed-batch-1234", "signed-batch-9999");
        c.apply_batch(changed, fixture_approvals(&f));
    }
    #[test]
    #[should_panic(expected = "Batch replay")]
    fn confirmed_batch_cannot_replay() {
        let (mut c, f) = signed_fixture();
        approve_fixture(&mut c, &f);
        context("oracle.testnet");
        c.apply_batch(f["batch"].as_str().unwrap().into(), fixture_approvals(&f));
        c.apply_batch(f["batch"].as_str().unwrap().into(), fixture_approvals(&f));
    }
    #[test]
    #[should_panic(expected = "Authority permit replay")]
    fn authority_permit_cannot_reset_spending_budget() {
        let (mut c, f) = signed_fixture();
        approve_fixture(&mut c, &f);
        approve_fixture(&mut c, &f);
    }
    #[test]
    #[should_panic(expected = "Authority scope mismatch")]
    fn another_account_cannot_use_authority_permit() {
        let (mut c, f) = signed_fixture();
        context("bob.testnet");
        c.authorize_game(
            f["authorization"].as_str().unwrap().into(),
            near_sdk::serde_json::from_value(f["authorizationSignature"].clone()).unwrap(),
        );
    }
    #[test]
    #[should_panic(expected = "Game authority revoked")]
    fn revoked_authority_prevents_unsettled_player_debits() {
        let (mut c, f) = signed_fixture();
        approve_fixture(&mut c, &f);
        c.revoke_game(
            f["revocation0"].as_str().unwrap().into(),
            near_sdk::serde_json::from_value(f["revocationSignature0"].clone()).unwrap(),
        );
        context("oracle.testnet");
        c.apply_batch(f["batch"].as_str().unwrap().into(), fixture_approvals(&f));
    }

    #[test]
    fn harvested_contract_delivery_mints_into_buyer_city() {
        let mut c = setup();
        register(&mut c);
        let mut p = plan("contract_deliver", 2);
        p.mints.push(Mint {
            to: id("refinery.testnet"),
            token_id: "crude_oil".into(),
            amount: 3,
            reason: "harvest".into(),
        });
        p.transfers.push(Transfer {
            from: id("refinery.testnet"),
            to: p.account_id.clone(),
            token_id: "coin".into(),
            amount: 30,
        });
        c.apply_plan(p, false);
        assert_eq!(c.balance(&id("refinery.testnet"), "crude_oil"), 3);
        assert_eq!(c.balance(&id("alice.testnet"), "coin"), 130);
    }
    #[test]
    fn city_tick_can_refund_held_contract_collateral() {
        let mut c = setup();
        register(&mut c);
        let mut p = plan("tick", 2);
        p.transfers.push(Transfer {
            from: id("refinery.testnet"),
            to: id("alice.testnet"),
            token_id: "coin".into(),
            amount: 30,
        });
        c.apply_plan(p, true);
        assert_eq!(c.balance(&id("alice.testnet"), "coin"), 130);
        assert_eq!(c.total("coin"), 136000);
    }

    #[test]
    fn revocation_preserves_already_accepted_actions() {
        let (mut c, f) = signed_fixture();
        approve_fixture(&mut c, &f);
        c.revoke_game(
            f["revocation1"].as_str().unwrap().into(),
            near_sdk::serde_json::from_value(f["revocationSignature1"].clone()).unwrap(),
        );
        context("oracle.testnet");
        c.apply_batch(f["batch"].as_str().unwrap().into(), fixture_approvals(&f));
        assert_eq!(c.balance(&id("alice.testnet"), "coin"), 100);
        assert!(c.game_authority(id("alice.testnet")).unwrap().revoked);
    }
    #[test]
    #[should_panic(expected = "Invalid revocation permit")]
    fn forged_revocation_cutoff_rejected() {
        let (mut c, f) = signed_fixture();
        approve_fixture(&mut c, &f);
        let changed = f["revocation0"]
            .as_str()
            .unwrap()
            .replace("lastAcceptedNonce\":0", "lastAcceptedNonce\":99");
        c.revoke_game(
            changed,
            near_sdk::serde_json::from_value(f["revocationSignature0"].clone()).unwrap(),
        );
    }
    #[test]
    #[should_panic(expected = "Game assets are locked")]
    fn direct_wallet_transfer_cannot_race_queued_game_spending() {
        let mut c = setup();
        register(&mut c);
        let mut b = VMContextBuilder::new();
        b.current_account_id(id("worldo.testnet"))
            .predecessor_account_id(id("alice.testnet"))
            .signer_account_id(id("alice.testnet"))
            .attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(b.build());
        c.mt_transfer(id("motor.testnet"), "coin".into(), U128(100), None, None);
    }
    #[test]
    #[should_panic(expected = "Game assets are locked")]
    fn direct_batch_transfer_cannot_change_deed_ownership() {
        let mut c = setup();
        owned_station(&mut c);
        let mut b = VMContextBuilder::new();
        b.current_account_id(id("worldo.testnet"))
            .predecessor_account_id(id("alice.testnet"))
            .signer_account_id(id("alice.testnet"))
            .attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(b.build());
        c.mt_batch_transfer(
            id("motor.testnet"),
            vec!["station:refinery:1".into()],
            vec![U128(1)],
            None,
            None,
        );
    }

    #[test]
    fn sponsored_authorization_uses_player_predecessor_not_relayer_signer() {
        let (mut c, f) = signed_fixture();
        let mut b = VMContextBuilder::new();
        b.current_account_id(id("worldo.testnet"))
            .predecessor_account_id(id("alice.testnet"))
            .signer_account_id(id("relayer.testnet"))
            .block_timestamp(1_000_000_000_000);
        testing_env!(b.build());
        c.authorize_game(
            f["authorization"].as_str().unwrap().into(),
            near_sdk::serde_json::from_value(f["authorizationSignature"].clone()).unwrap(),
        );
        assert!(c.game_authority(id("alice.testnet")).is_some());
        c.revoke_game(
            f["revocation1"].as_str().unwrap().into(),
            near_sdk::serde_json::from_value(f["revocationSignature1"].clone()).unwrap(),
        );
        assert!(c.game_authority(id("alice.testnet")).unwrap().revoked);
    }

    #[test]
    fn receipt_eviction_keeps_balances_and_player_nonce() {
        let mut c = setup();
        register(&mut c);
        assert!(c.settlement("operation-1".into()).is_some());
        c.ledger_revision = RECEIPT_HISTORY;
        let p = plan("station_price", 2);
        c.apply_plan(p, false);
        assert!(c.settlement("operation-1".into()).is_none());
        assert!(c.settlement("operation-2".into()).is_some());
        assert_eq!(c.account(id("alice.testnet")).unwrap().nonce, 2);
        assert_eq!(c.balance(&id("alice.testnet"), "coin"), 100);
    }
    #[test]
    #[should_panic(expected = "Tick nonce replay")]
    fn evicted_tick_cannot_replay_with_another_operation_id() {
        let mut c = setup();
        let mut p = plan("tick", 1);
        p.account_id = id("city-simulation");
        c.apply_plan(p.clone(), true);
        p.id = "different-tick-id".into();
        c.apply_plan(p, true);
    }

    #[test]
    #[should_panic(expected = "Only contract account can initialize")]
    fn attacker_cannot_initialize_another_contract_account() {
        context("attacker.testnet");
        Worldo::new(
            id("attacker.testnet"),
            id("oracle.testnet"),
            "ed25519:11111111111111111111111111111111".parse().unwrap(),
            "testnet".into(),
            vec![],
            100000,
        );
    }
}

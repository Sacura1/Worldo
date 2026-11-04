//! Lowland's funded resource economy. The server is a trusted harvest oracle;
//! users retain their own NEAR keys. Implements the NEP-245 core interface;
//! optional approvals, enumeration, and metadata extensions are not implemented.
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};
use near_sdk::json_types::U128;
#[cfg(test)]
use near_sdk::PromiseResult;
use near_sdk::store::LookupMap;

const STORAGE: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR reserved per fixed-size account.
const UNIT: u128 = 1_000_000_000_000_000_000_000; // 0.001 NEAR (1 NEAR = 10^24 yoctoNEAR)
const DAY_NS: u64 = 86_400_000_000_000;
const BASE: [u128; 6] = [2, 3, 2, 7, 10, 7];

#[near(serializers=[borsh])]
#[derive(Clone)]
pub struct Holding {
    items: [u128;6], balance: u128, harvest_nonce: u64,
    harvest_day: u64, harvested_today: u64, refinery: bool,
}
impl Default for Holding {
    fn default() -> Self { Self { items:[0;6], balance:0, harvest_nonce:0, harvest_day:0, harvested_today:0, refinery:false } }
}
#[near(serializers=[json])]
pub struct AccountView { pub inventory: Vec<U128>, pub balance: U128, pub harvest_nonce: u64, pub refinery: bool }
#[near(serializers=[json])]
pub struct Token { pub token_id: String, pub owner_id: Option<AccountId> }

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Lowland {
    owner: AccountId, oracle: AccountId,
    accounts: LookupMap<AccountId,Holding>, merchants: LookupMap<AccountId,String>,
    supply:[u128;6], paused:bool,
}

#[near]
impl Lowland {
    #[init]
    pub fn new(owner: AccountId, oracle: AccountId) -> Self {
        require!(env::predecessor_account_id()==owner,"Only owner can initialize");
        let mut accounts=LookupMap::new(b"a");accounts.insert(owner.clone(),Holding::default());
        Self {owner,oracle,accounts,merchants:LookupMap::new(b"m"),supply:[0;6],paused:true}
    }
    pub fn set_paused(&mut self,paused:bool){self.assert_owner();self.paused=paused;}
    pub fn set_oracle(&mut self,oracle:AccountId){self.assert_owner();self.oracle=oracle;}
    pub fn register_merchant(&mut self,account_id:AccountId,kind:String){
        self.assert_owner();require!(["refinery","foundry","sawmill","depot"].contains(&kind.as_str()),"Unknown business");
        require!(self.accounts.contains_key(&account_id),"Register storage first");
        self.merchants.insert(account_id,kind);
    }
    #[payable]
    pub fn register(&mut self){
        let account=env::predecessor_account_id();require!(!self.accounts.contains_key(&account),"Already registered");
        let paid=env::attached_deposit().as_yoctonear();require!(paid>=STORAGE,"Attach at least 0.01 NEAR for storage");
        let before=env::storage_usage();
        let mut holding=Holding::default();holding.balance=paid-STORAGE;self.accounts.insert(account,holding);self.accounts.flush();
        let cost=(env::storage_usage()-before)as u128*env::storage_byte_cost().as_yoctonear();
        require!(cost<=STORAGE,"Account storage exceeds reserved deposit");
    }
    /// Anyone can fund a registered player or business; this never creates NEAR.
    #[payable]
    pub fn deposit(&mut self,account_id:Option<AccountId>){
        let id=account_id.unwrap_or_else(env::predecessor_account_id);let mut account=self.get(&id);
        let amount=env::attached_deposit().as_yoctonear();require!(amount>0,"Deposit is empty");
        account.balance=account.balance.checked_add(amount).expect("Balance overflow");self.accounts.insert(id,account);
    }
    /// Effects precede transfer; a failed transfer restores the ledger via callback.
    #[payable]
    pub fn withdraw(&mut self,amount:U128)->Promise{
        near_sdk::assert_one_yocto();let id=env::predecessor_account_id();let mut account=self.get(&id);
        require!(amount.0>0&&account.balance>=amount.0,"Insufficient balance");account.balance-=amount.0;self.accounts.insert(id.clone(),account);
        Promise::new(id.clone()).transfer(NearToken::from_yoctonear(amount.0)).then(
            Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).withdraw_callback(id,amount))
    }
    #[private]
    pub fn withdraw_callback(&mut self,account_id:AccountId,amount:U128)->bool{
        if env::promise_result_checked(0,0).is_ok(){return true;}
        let mut account=self.get(&account_id);account.balance=account.balance.checked_add(amount.0).expect("Balance overflow");self.accounts.insert(account_id,account);false
    }
    /// Oracle issues only verified harvests. Monotonic nonce prevents replay.
    pub fn grant_harvest(&mut self,account_id:AccountId,token_id:String,amount:U128,nonce:u64){
        self.assert_running();require!(env::predecessor_account_id()==self.oracle,"Only harvest oracle");
        let token=Self::token_index(&token_id);require!(token<3,"Only raw materials can be harvested");
        require!(amount.0>0&&amount.0<=10,"Harvest must be 1 to 10 units");
        let mut account=self.get(&account_id);require!(nonce==account.harvest_nonce+1,"Harvest replay or missing nonce");
        let day=env::block_timestamp()/DAY_NS;if day!=account.harvest_day{account.harvest_day=day;account.harvested_today=0;}
        require!(account.harvested_today+amount.0 as u64<=100,"Daily harvest limit");
        account.harvested_today+=amount.0 as u64;account.harvest_nonce=nonce;account.items[token]+=amount.0;self.supply[token]+=amount.0;
        self.accounts.insert(account_id.clone(),account);Self::event("mt_mint",near_sdk::serde_json::json!([{ "owner_id":account_id,"token_ids":[token_id],"amounts":[amount]}]));
    }
    /// The player accepts a bounded total, not a client-selected unit price.
    #[payable]
    pub fn trade(&mut self,merchant_id:AccountId,token_id:String,amount:U128,buy:bool,limit:U128)->U128{
        near_sdk::assert_one_yocto();self.assert_running();let player_id=env::predecessor_account_id();require!(player_id!=merchant_id,"Self trade");
        let kind=self.merchants.get(&merchant_id).expect("Unknown merchant");let i=Self::token_index(&token_id);
        require!(Self::accepts(kind,i),"Business does not trade this item");require!(amount.0>0&&amount.0<=100,"Trade 1 to 100 units");
        let mut player=self.get(&player_id);let mut merchant=self.get(&merchant_id);
        let total=Self::total(merchant.items[i],i,amount.0,buy);
        if buy {
            require!(total<=limit.0,"Price rose above your limit");require!(player.balance>=total,"Insufficient funds");require!(merchant.items[i]>=amount.0,"Out of stock");
            player.balance-=total;merchant.balance+=total;merchant.items[i]-=amount.0;player.items[i]+=amount.0;
        } else {
            require!(total>=limit.0,"Price fell below your limit");require!(merchant.balance>=total,"Merchant cannot afford this order");require!(player.items[i]>=amount.0,"Not enough cargo");
            merchant.balance-=total;player.balance+=total;player.items[i]-=amount.0;merchant.items[i]+=amount.0;
        }
        self.accounts.insert(player_id.clone(),player);self.accounts.insert(merchant_id.clone(),merchant);
        Self::event("mt_transfer",near_sdk::serde_json::json!([{ "old_owner_id":if buy{merchant_id.clone()}else{player_id.clone()},"new_owner_id":if buy{player_id}else{merchant_id},"token_ids":[token_id],"amounts":[amount]}]));U128(total)
    }
    pub fn quote(&self,merchant_id:AccountId,token_id:String,amount:U128,buy:bool)->U128{
        require!(amount.0>0&&amount.0<=100,"Trade 1 to 100 units");let i=Self::token_index(&token_id);let kind=self.merchants.get(&merchant_id).expect("Unknown merchant");require!(Self::accepts(kind,i),"Unsupported item");U128(Self::total(self.get(&merchant_id).items[i],i,amount.0,buy))
    }
    #[payable]
    pub fn process(&mut self,merchant_id:AccountId,token_id:String,batches:u32){
        near_sdk::assert_one_yocto();self.assert_running();require!(batches>0&&batches<=20,"Process 1 to 20 batches");
        let id=env::predecessor_account_id();require!(id!=merchant_id,"Self processing");let i=Self::token_index(&token_id);require!(i<3,"Raw materials only");
        let kind=self.merchants.get(&merchant_id).expect("Unknown business");require!((i==0&&kind=="refinery")||(i==1&&kind=="foundry")||(i==2&&kind=="sawmill"),"Wrong processor");
        let n=batches as u128;let fee=UNIT*n;let mut player=self.get(&id);let mut merchant=self.get(&merchant_id);
        require!(player.items[i]>=2*n&&player.balance>=fee,"Missing materials or processing fee");
        player.items[i]-=2*n;player.items[i+3]+=n;player.balance-=fee;merchant.balance+=fee;self.supply[i]-=2*n;self.supply[i+3]+=n;
        self.accounts.insert(id.clone(),player);self.accounts.insert(merchant_id,merchant);
        Self::event("mt_burn",near_sdk::serde_json::json!([{ "owner_id":id,"token_ids":[token_id],"amounts":[U128(2*n)]}]));
        Self::event("mt_mint",near_sdk::serde_json::json!([{ "owner_id":id,"token_ids":[Self::token_name(i+3)],"amounts":[U128(n)]}]));
    }
    /// A funded NPC business processes its purchased stock using its own account.
    /// This changes inventories and prices without an owner patch or token faucet.
    pub fn produce_stock(&mut self,batches:u32){
        self.assert_running();require!(batches>0&&batches<=20,"Process 1 to 20 batches");
        let id=env::predecessor_account_id();let kind=self.merchants.get(&id).expect("Only registered businesses");
        let i=match kind.as_str(){"refinery"=>0,"foundry"=>1,"sawmill"=>2,_=>env::panic_str("This business does not process resources")};
        let n=batches as u128;let mut merchant=self.get(&id);require!(merchant.items[i]>=2*n,"Not enough purchased stock");
        merchant.items[i]-=2*n;merchant.items[i+3]+=n;self.supply[i]-=2*n;self.supply[i+3]+=n;self.accounts.insert(id.clone(),merchant);
        Self::event("mt_burn",near_sdk::serde_json::json!([{ "owner_id":id,"token_ids":[Self::token_name(i)],"amounts":[U128(2*n)]}]));
        Self::event("mt_mint",near_sdk::serde_json::json!([{ "owner_id":id,"token_ids":[Self::token_name(i+3)],"amounts":[U128(n)]}]));
    }
    #[payable]
    pub fn build_refinery(&mut self){
        near_sdk::assert_one_yocto();self.assert_running();let id=env::predecessor_account_id();let mut player=self.get(&id);
        require!(!player.refinery,"Already built");require!(player.items[4]>=10&&player.items[5]>=10,"Needs 10 steel and 10 planks");
        player.items[4]-=10;player.items[5]-=10;self.supply[4]-=10;self.supply[5]-=10;player.refinery=true;self.accounts.insert(id.clone(),player);
        Self::event("mt_burn",near_sdk::serde_json::json!([{ "owner_id":id,"token_ids":["steel","planks"],"amounts":["10","10"]}]));
    }
    #[payable]
    pub fn refine_owned(&mut self,batches:u32){
        near_sdk::assert_one_yocto();self.assert_running();require!(batches>0&&batches<=20,"Process 1 to 20 batches");
        let id=env::predecessor_account_id();let mut player=self.get(&id);require!(player.refinery,"Build a refinery first");let n=batches as u128;
        require!(player.items[0]>=2*n,"Not enough crude oil");player.items[0]-=2*n;player.items[3]+=n;self.supply[0]-=2*n;self.supply[3]+=n;self.accounts.insert(id.clone(),player);
        Self::event("mt_burn",near_sdk::serde_json::json!([{ "owner_id":id,"token_ids":["crude"],"amounts":[U128(2*n)]}]));
        Self::event("mt_mint",near_sdk::serde_json::json!([{ "owner_id":id,"token_ids":["petrol"],"amounts":[U128(n)]}]));
    }
    /// Server confirms fuel use and records an idempotent command nonce.
    pub fn consume_fuel(&mut self,account_id:AccountId,amount:U128,nonce:u64){
        self.assert_running();require!(env::predecessor_account_id()==self.oracle,"Only gameplay oracle");require!(amount.0>0&&amount.0<=10,"Invalid consumption");
        let mut player=self.get(&account_id);require!(nonce==player.harvest_nonce+1,"Command replay");require!(player.items[3]>=amount.0,"No fuel");
        player.items[3]-=amount.0;player.harvest_nonce=nonce;self.supply[3]-=amount.0;self.accounts.insert(account_id.clone(),player);
        Self::event("mt_burn",near_sdk::serde_json::json!([{ "owner_id":account_id,"token_ids":["petrol"],"amounts":[amount]}]));
    }
    #[payable]
    pub fn mt_transfer(&mut self,receiver_id:AccountId,token_id:String,amount:U128,approval:Option<(AccountId,u64)>,memo:Option<String>){
        near_sdk::assert_one_yocto();self.assert_running();require!(approval.is_none(),"Approval extension is not supported");require!(memo.as_ref().map_or(true,|s|s.len()<=256),"Memo too long");self.transfer(&env::predecessor_account_id(),&receiver_id,&token_id,amount.0);
    }
    #[payable]
    pub fn mt_batch_transfer(&mut self,receiver_id:AccountId,token_ids:Vec<String>,amounts:Vec<U128>,approvals:Option<Vec<Option<(AccountId,u64)>>>,memo:Option<String>){
        near_sdk::assert_one_yocto();self.assert_running();Self::check_approvals(&approvals,token_ids.len());require!(!token_ids.is_empty()&&token_ids.len()<=6&&token_ids.len()==amounts.len(),"Invalid batch");require!(memo.as_ref().map_or(true,|s|s.len()<=256),"Memo too long");let sender=env::predecessor_account_id();for (token,amount)in token_ids.iter().zip(amounts){self.transfer(&sender,&receiver_id,token,amount.0);}
    }
    #[payable]
    pub fn mt_transfer_call(&mut self,receiver_id:AccountId,token_id:String,amount:U128,approval:Option<(AccountId,u64)>,memo:Option<String>,msg:String)->Promise{
        require!(approval.is_none(),"Approval extension is not supported");
        self.mt_batch_transfer_call(receiver_id,vec![token_id],vec![amount],None,memo,msg)
    }
    #[payable]
    pub fn mt_batch_transfer_call(&mut self,receiver_id:AccountId,token_ids:Vec<String>,amounts:Vec<U128>,approvals:Option<Vec<Option<(AccountId,u64)>>>,memo:Option<String>,msg:String)->Promise{
        near_sdk::assert_one_yocto();self.assert_running();Self::check_approvals(&approvals,token_ids.len());
        require!(!token_ids.is_empty()&&token_ids.len()<=6&&token_ids.len()==amounts.len(),"Invalid batch");
        require!(msg.len()<=4096&&memo.as_ref().map_or(true,|s|s.len()<=256),"Message too long");
        require!(env::prepaid_gas().as_gas()>=80_000_000_000_000,"Attach at least 80 TGas");
        let sender_id=env::predecessor_account_id();
        for(token,amount)in token_ids.iter().zip(&amounts){self.transfer(&sender_id,&receiver_id,token,amount.0);}
        let args=near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"sender_id":sender_id,"previous_owner_ids":vec![sender_id.clone();token_ids.len()],"token_ids":token_ids,"amounts":amounts,"msg":msg})).unwrap();
        Promise::new(receiver_id.clone()).function_call("mt_on_transfer",args,NearToken::from_yoctonear(0),Gas::from_tgas(40))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(20)).mt_resolve_transfer(sender_id,receiver_id,token_ids,amounts))
    }
    #[private]
    pub fn mt_resolve_transfer(&mut self,sender_id:AccountId,receiver_id:AccountId,token_ids:Vec<String>,amounts:Vec<U128>)->Vec<U128>{
        require!(env::predecessor_account_id()==env::current_account_id(),"Only this contract can resolve transfers");
        require!(token_ids.len()==amounts.len()&&token_ids.len()<=6,"Invalid resolution");
        let unused=match env::promise_result_checked(0,1024){
            Ok(bytes)=>near_sdk::serde_json::from_slice::<Vec<U128>>(&bytes).ok().filter(|v|v.len()==amounts.len()).unwrap_or_else(||amounts.clone()),
            _=>amounts.clone(),
        };
        // Receiver may have spent some tokens in another receipt. Refund only
        // the unspent balance, bounded by both the original and returned amount.
        token_ids.iter().zip(amounts.iter()).zip(unused.iter()).map(|((token,amount),unused)|{
            let i=Self::token_index(token);let available=self.get(&receiver_id).items[i];let refund=amount.0.min(unused.0).min(available);
            if refund>0{self.transfer(&receiver_id,&sender_id,token,refund);}
            U128(amount.0-refund)
        }).collect()
    }
    pub fn mt_balance_of(&self,account_id:AccountId,token_id:String)->U128{U128(Self::find_token(&token_id).map_or(0,|i|self.accounts.get(&account_id).map_or(0,|a|a.items[i])))}
    pub fn mt_batch_balance_of(&self,account_id:AccountId,token_ids:Vec<String>)->Vec<U128>{require!(token_ids.len()<=6,"Too many tokens");token_ids.into_iter().map(|id|self.mt_balance_of(account_id.clone(),id)).collect()}
    pub fn mt_supply(&self,token_id:String)->Option<U128>{Self::find_token(&token_id).map(|i|U128(self.supply[i]))}
    pub fn mt_batch_supply(&self,token_ids:Vec<String>)->Vec<Option<U128>>{require!(token_ids.len()<=6,"Too many tokens");token_ids.into_iter().map(|token|self.mt_supply(token)).collect()}
    pub fn mt_token(&self,token_ids:Vec<String>)->Vec<Option<Token>>{require!(token_ids.len()<=6,"Too many tokens");token_ids.into_iter().map(|token_id|Self::find_token(&token_id).map(|_|Token{token_id,owner_id:None})).collect()}
    pub fn account(&self,account_id:AccountId)->Option<AccountView>{self.accounts.get(&account_id).map(|a|AccountView{inventory:a.items.iter().map(|v|U128(*v)).collect(),balance:U128(a.balance),harvest_nonce:a.harvest_nonce,refinery:a.refinery})}
    pub fn is_paused(&self)->bool{self.paused}
}
impl Lowland {
    fn check_approvals(approvals:&Option<Vec<Option<(AccountId,u64)>>>,length:usize){if let Some(list)=approvals{require!(list.len()==length,"Approval list length mismatch");require!(list.iter().all(Option::is_none),"Approval extension is not supported");}}
    fn assert_owner(&self){require!(env::predecessor_account_id()==self.owner,"Only owner");}
    fn assert_running(&self){require!(!self.paused,"Economy paused");}
    fn get(&self,id:&AccountId)->Holding{self.accounts.get(id).expect("Register an account first").clone()}
    fn find_token(id:&str)->Option<usize>{["crude","ore","timber","petrol","steel","planks"].iter().position(|s|*s==id)}
    fn token_index(id:&str)->usize{Self::find_token(id).unwrap_or_else(||env::panic_str("Unknown resource"))}
    fn token_name(index:usize)->&'static str{["crude","ore","timber","petrol","steel","planks"][index]}
    fn accepts(kind:&str,i:usize)->bool{match kind{"refinery"=>i==0||i==3,"foundry"=>i==1||i==4,"sawmill"=>i==2||i==5,"depot"=>i>=3,_=>false}}
    fn total(stock:u128,i:usize,amount:u128,buy:bool)->u128{
        if buy{require!(stock>=amount,"Not enough stock");}
        (0..amount).map(|n|{let s=if buy{stock-n}else{stock+n};let scarcity=180_u128.saturating_sub(s.min(140));let factor=if buy{125}else{80};BASE[i]*UNIT*scarcity*factor/10_000}).sum()
    }
    fn transfer(&mut self,sender:&AccountId,receiver:&AccountId,token:&str,amount:u128){
        require!(sender!=receiver,"Self transfer");require!(amount>0,"Empty transfer");let i=Self::token_index(token);let mut from=self.get(sender);let mut to=self.get(receiver);require!(from.items[i]>=amount,"Insufficient items");from.items[i]-=amount;to.items[i]=to.items[i].checked_add(amount).expect("Item overflow");self.accounts.insert(sender.clone(),from);self.accounts.insert(receiver.clone(),to);
        Self::event("mt_transfer",near_sdk::serde_json::json!([{ "old_owner_id":sender,"new_owner_id":receiver,"token_ids":[token],"amounts":[U128(amount)]}]));
    }
    fn event(event:&str,data:near_sdk::serde_json::Value){env::log_str(&format!("EVENT_JSON:{}",near_sdk::serde_json::json!({"standard":"nep245","version":"1.0.0","event":event,"data":data})));}
}

#[cfg(test)]
mod tests{
 use super::*;use near_sdk::{testing_env,test_utils::VMContextBuilder};
 fn id(s:&str)->AccountId{s.parse().unwrap()}
 fn context(who:&str,deposit:u128){let mut c=VMContextBuilder::new();c.current_account_id(id("game.near")).predecessor_account_id(id(who)).signer_account_id(id(who)).attached_deposit(NearToken::from_yoctonear(deposit));testing_env!(c.build());}
 fn setup()->Lowland{context("owner.near",0);let mut c=Lowland::new(id("owner.near"),id("oracle.near"));c.set_paused(false);context("alice.near",STORAGE+100*UNIT);c.register();context("refinery.near",STORAGE+100*UNIT);c.register();context("owner.near",0);c.register_merchant(id("refinery.near"),"refinery".into());c}
 fn harvest_raw(c:&mut Lowland,who:&str,resource:&str,mut amount:u128){
  while amount>0{
   let batch=amount.min(10);let nonce=c.account(id(who)).unwrap().harvest_nonce+1;
   context("oracle.near",0);c.grant_harvest(id(who),resource.into(),U128(batch),nonce);amount-=batch;
  }
 }
 /// Construction materials come through the same harvest/processing APIs as play.
 fn construction_materials(steel:u32,planks:u32)->Lowland{
  let mut c=setup();
  for (account,kind) in [("foundry.near","foundry"),("sawmill.near","sawmill")]{
   context(account,STORAGE);c.register();context("owner.near",0);c.register_merchant(id(account),kind.into());
  }
  harvest_raw(&mut c,"alice.near","ore",2*steel as u128);
  harvest_raw(&mut c,"alice.near","timber",2*planks as u128);
  context("alice.near",1);c.process(id("foundry.near"),"ore".into(),steel);
  context("alice.near",1);c.process(id("sawmill.near"),"timber".into(),planks);c
 }
 fn ledger_total(c:&Lowland)->u128{
  ["owner.near","alice.near","bob.near","refinery.near","foundry.near","sawmill.near"].iter()
   .filter_map(|who|c.account(id(who))).map(|account|account.balance.0).sum()
 }
 #[test]fn deposits_preserve_principal(){let c=setup();assert_eq!(c.account(id("alice.near")).unwrap().balance.0,100*UNIT);}
 #[test]fn trades_conserve_money_and_goods(){let mut c=setup();context("oracle.near",0);c.grant_harvest(id("alice.near"),"crude".into(),U128(5),1);let before=c.get(&id("alice.near")).balance+c.get(&id("refinery.near")).balance;context("alice.near",1);c.trade(id("refinery.near"),"crude".into(),U128(5),false,U128(0));assert_eq!(before,c.get(&id("alice.near")).balance+c.get(&id("refinery.near")).balance);assert_eq!(c.mt_balance_of(id("refinery.near"),"crude".into()).0,5);assert_eq!(c.mt_supply("crude".into()).unwrap().0,5);}
 #[test]#[should_panic(expected="Only harvest oracle")]fn players_cannot_mint(){let mut c=setup();context("alice.near",0);c.grant_harvest(id("alice.near"),"crude".into(),U128(1),1);}
 #[test]#[should_panic(expected="Harvest replay")]fn harvest_cannot_replay(){let mut c=setup();context("oracle.near",0);c.grant_harvest(id("alice.near"),"crude".into(),U128(1),1);c.grant_harvest(id("alice.near"),"crude".into(),U128(1),1);}
 #[test]fn buy_sell_spread_prevents_free_money(){for stock in 1..150{let cost=Lowland::total(stock,0,1,true);let returned=Lowland::total(stock-1,0,1,false);assert!(returned<cost);}}
 #[test]fn production_consumes_inputs(){let mut c=setup();context("oracle.near",0);c.grant_harvest(id("alice.near"),"crude".into(),U128(4),1);context("alice.near",1);c.process(id("refinery.near"),"crude".into(),2);assert_eq!(c.mt_supply("crude".into()).unwrap().0,0);assert_eq!(c.mt_supply("petrol".into()).unwrap().0,2);}
 #[test]
 fn processing_charges_exactly_one_millinear_in_yocto(){
  let mut c=setup();harvest_raw(&mut c,"alice.near","crude",2);
  let player_before=c.account(id("alice.near")).unwrap().balance.0;
  let merchant_before=c.account(id("refinery.near")).unwrap().balance.0;
  let total_before=ledger_total(&c);
  context("alice.near",1);c.process(id("refinery.near"),"crude".into(),1);
  // Literal external denomination: this must fail if UNIT is accidentally 10^18.
  let expected_fee:u128=1_000_000_000_000_000_000_000;
  assert_eq!(player_before-c.account(id("alice.near")).unwrap().balance.0,expected_fee);
  assert_eq!(c.account(id("refinery.near")).unwrap().balance.0-merchant_before,expected_fee);
  assert_eq!(ledger_total(&c),total_before);
  assert_eq!(c.mt_balance_of(id("alice.near"),"crude".into()).0,0);
  assert_eq!(c.mt_balance_of(id("alice.near"),"petrol".into()).0,1);
 }
 #[test]
 fn trade_quotes_use_near_yocto_denomination(){
  let mut c=setup();
  // Empty-stock crude bid: 2 * 0.001 NEAR * 180% scarcity * 80% bid.
  assert_eq!(c.quote(id("refinery.near"),"crude".into(),U128(1),false).0,2_880_000_000_000_000_000_000);
  harvest_raw(&mut c,"refinery.near","crude",2);context("refinery.near",0);c.produce_stock(1);
  // One-can petrol ask: 7 * 0.001 NEAR * 179% scarcity * 125% ask.
  assert_eq!(c.quote(id("refinery.near"),"petrol".into(),U128(1),true).0,15_662_500_000_000_000_000_000);
 }
 #[test]fn unknown_tokens_have_no_supply(){let c=setup();assert!(c.mt_supply("missing".into()).is_none());assert!(c.mt_token(vec!["missing".into()])[0].is_none());}
 #[test]
 fn building_consumes_exact_materials_and_grants_only_builder_ownership(){
  let mut c=construction_materials(12,11);let money=ledger_total(&c);let balance=c.account(id("alice.near")).unwrap().balance.0;
  context("alice.near",1);c.build_refinery();
  let player=c.account(id("alice.near")).unwrap();assert!(player.refinery);assert_eq!(player.inventory[4].0,2);assert_eq!(player.inventory[5].0,1);
  assert_eq!(c.mt_supply("steel".into()).unwrap().0,2);assert_eq!(c.mt_supply("planks".into()).unwrap().0,1);
  assert!(!c.account(id("refinery.near")).unwrap().refinery);assert_eq!(player.balance.0,balance);assert_eq!(ledger_total(&c),money);
 }
 #[test]
 fn construction_needs_materials_but_no_game_balance_fee(){
  let mut c=construction_materials(10,10);context("bob.near",STORAGE);c.register();
  context("alice.near",1);c.mt_batch_transfer(id("bob.near"),vec!["steel".into(),"planks".into()],vec![U128(10),U128(10)],None,None);
  assert_eq!(c.account(id("bob.near")).unwrap().balance.0,0);let money=ledger_total(&c);
  context("bob.near",1);c.build_refinery();assert!(c.account(id("bob.near")).unwrap().refinery);
  assert!(!c.account(id("alice.near")).unwrap().refinery);assert_eq!(c.account(id("bob.near")).unwrap().balance.0,0);assert_eq!(ledger_total(&c),money);
 }
 #[test]
 #[should_panic(expected="Already built")]
 fn duplicate_construction_is_rejected(){let mut c=construction_materials(10,10);context("alice.near",1);c.build_refinery();c.build_refinery();}
 #[test]
 #[should_panic(expected="Needs 10 steel and 10 planks")]
 fn construction_rejects_insufficient_steel(){let mut c=construction_materials(9,10);context("alice.near",1);c.build_refinery();}
 #[test]
 #[should_panic(expected="Needs 10 steel and 10 planks")]
 fn construction_rejects_insufficient_planks(){let mut c=construction_materials(10,9);context("alice.near",1);c.build_refinery();}
 #[test]
 #[should_panic]
 fn construction_requires_one_yocto_authorization(){let mut c=construction_materials(10,10);context("alice.near",0);c.build_refinery();}
 #[test]
 fn owned_refining_consumes_crude_and_preserves_all_money(){
  let mut c=construction_materials(10,10);context("alice.near",1);c.build_refinery();harvest_raw(&mut c,"alice.near","crude",6);
  let money=ledger_total(&c);let balance=c.account(id("alice.near")).unwrap().balance.0;
  context("alice.near",1);c.refine_owned(2);let player=c.account(id("alice.near")).unwrap();
  assert_eq!(player.inventory[0].0,2);assert_eq!(player.inventory[3].0,2);assert!(player.refinery);
  assert_eq!(c.mt_supply("crude".into()).unwrap().0,2);assert_eq!(c.mt_supply("petrol".into()).unwrap().0,2);
  assert_eq!(player.balance.0,balance);assert_eq!(ledger_total(&c),money);
 }
 #[test]
 #[should_panic(expected="Build a refinery first")]
 fn one_players_refinery_does_not_authorize_another_players_production(){
  let mut c=construction_materials(10,10);context("alice.near",1);c.build_refinery();
  context("bob.near",STORAGE);c.register();harvest_raw(&mut c,"bob.near","crude",2);context("bob.near",1);c.refine_owned(1);
 }
 #[test]
 #[should_panic(expected="Not enough crude oil")]
 fn owned_refining_rejects_insufficient_crude(){
  let mut c=construction_materials(10,10);context("alice.near",1);c.build_refinery();harvest_raw(&mut c,"alice.near","crude",3);context("alice.near",1);c.refine_owned(2);
 }
 #[allow(deprecated)]
 fn resolution_context(result:PromiseResult){let mut b=VMContextBuilder::new();b.current_account_id(id("game.near")).predecessor_account_id(id("game.near")).signer_account_id(id("alice.near"));near_sdk::test_utils::testing_env_with_promise_results(b.build(),result);}
 #[test]fn transfer_call_refunds_unused_tokens(){let mut c=setup();context("oracle.near",0);c.grant_harvest(id("alice.near"),"crude".into(),U128(5),1);context("alice.near",1);c.mt_transfer(id("refinery.near"),"crude".into(),U128(5),None,None);resolution_context(PromiseResult::Successful(br#"["2"]"#.to_vec()));let used=c.mt_resolve_transfer(id("alice.near"),id("refinery.near"),vec!["crude".into()],vec![U128(5)]);assert_eq!(used[0].0,3);assert_eq!(c.mt_balance_of(id("alice.near"),"crude".into()).0,2);}
 #[test]fn failed_receiver_refunds_all_unspent_tokens(){let mut c=setup();context("oracle.near",0);c.grant_harvest(id("alice.near"),"crude".into(),U128(5),1);context("alice.near",1);c.mt_transfer(id("refinery.near"),"crude".into(),U128(5),None,None);resolution_context(PromiseResult::Failed);let used=c.mt_resolve_transfer(id("alice.near"),id("refinery.near"),vec!["crude".into()],vec![U128(5)]);assert_eq!(used[0].0,0);assert_eq!(c.mt_balance_of(id("alice.near"),"crude".into()).0,5);}
 #[test]fn oversized_refund_is_capped(){let mut c=setup();context("oracle.near",0);c.grant_harvest(id("alice.near"),"crude".into(),U128(5),1);context("alice.near",1);c.mt_transfer(id("refinery.near"),"crude".into(),U128(5),None,None);resolution_context(PromiseResult::Successful(br#"["999999"]"#.to_vec()));let used=c.mt_resolve_transfer(id("alice.near"),id("refinery.near"),vec!["crude".into()],vec![U128(5)]);assert_eq!(used[0].0,0);assert_eq!(c.mt_supply("crude".into()).unwrap().0,5);}
 #[test]fn oversized_receiver_result_refunds_without_parsing(){let mut c=setup();context("oracle.near",0);c.grant_harvest(id("alice.near"),"crude".into(),U128(5),1);context("alice.near",1);c.mt_transfer(id("refinery.near"),"crude".into(),U128(5),None,None);resolution_context(PromiseResult::Successful(vec![b' ';1025]));let used=c.mt_resolve_transfer(id("alice.near"),id("refinery.near"),vec!["crude".into()],vec![U128(5)]);assert_eq!(used[0].0,0);assert_eq!(c.mt_balance_of(id("alice.near"),"crude".into()).0,5);}

}

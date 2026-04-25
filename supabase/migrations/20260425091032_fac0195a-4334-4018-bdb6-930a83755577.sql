CREATE OR REPLACE FUNCTION public._seed_regtest_identity() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n int;
BEGIN
  UPDATE workspaces SET
    doc_registered_name='Regression Test Co. Ltd.',
    doc_trade_name='RegTest',
    doc_address='12 Test Lane, Dhaka 1212, Bangladesh',
    doc_phone='+8801700000000',
    doc_email='billing@regtest.example',
    doc_bin='000123456789X',
    updated_at=now()
  WHERE id='23860f1b-546a-498e-afcc-f47c03502b4d'::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
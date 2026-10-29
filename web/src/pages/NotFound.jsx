export default function NotFound({ navigate }) {
  return (
    <section className="section">
      <h1 className="page-title">页面不存在</h1>
      <p className="muted">这个地址没有对应页面。</p>
      <button className="btn btn--primary" onClick={() => navigate('/')}>返回总览</button>
    </section>
  );
}
